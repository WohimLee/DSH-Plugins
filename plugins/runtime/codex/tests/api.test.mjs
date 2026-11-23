import test from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import { LlmRuntime } from '@deepseek-ai/dsh-llm';
import { applyCodexApi, discoverApiModels } from '../lib/api.js';

const list = (...ids) => Response.json({ data: ids.map(id => ({ id })) });
const success = () => new Response('data: {"type":"response.output_text.delta","delta":"OK"}\n\n' +
  'data: {"type":"response.completed"}\n\n');

test('OpenAI discovery filters other product models and classifies recoverable failures', async () => {
  const signal = new AbortController().signal;
  const discovered = await discoverApiModels('synthetic-key', signal, async (url, init) => {
    assert.equal(url, 'https://api.openai.com/v1/models');
    assert.equal(init.headers.authorization, 'Bearer synthetic-key');
    assert.equal(init.redirect, 'error');
    return list('gpt-5.3-codex', 'gpt-5.3-codex', 'gpt-5.1-codex-max', 'gpt-5.5', 'codex-mini-latest', 'ft:gpt-5.3-codex:other');
  });
  assert.deepEqual(discovered, { status: 'ok', models: ['codex-mini-latest', 'gpt-5.1-codex-max', 'gpt-5.3-codex'] });
  for (const [response, status] of [
    [new Response('synthetic-key', { status: 401 }), 'invalidKey'],
    [new Response('synthetic-key', { status: 429 }), 'network'],
    [list('gpt-5.5'), 'noModels'],
  ]) {
    assert.deepEqual(await discoverApiModels('synthetic-key', signal, async () => response), { status });
  }
});

test('Codex API settings discover, persist and remove independent API routes without exposing keys', async () => {
  const ctx = new Context();
  const runtime = ctx.plugin(LlmRuntime);
  const records = new Map();
  ctx.provide('credentials', {
    readRecord: async key => records.get(key),
    modifyRecord: async (key, change) => {
      assert.equal(key, 'dsh-codex/api-accounts');
      const next = await change(records.get(key));
      if (next) records.set(key, structuredClone(next));
    },
  });
  const keys = new Map([
    ['Bearer synthetic-work', ['gpt-5.3-codex', 'gpt-5.5']],
    ['Bearer synthetic-personal', ['gpt-5.2-codex']],
    ['Bearer synthetic-empty', ['gpt-5.5']],
  ]);
  const requests = [];
  const mockFetch = async (url, init) => {
    const models = keys.get(init.headers.authorization);
    if (!models) return new Response(init.headers.authorization, { status: 401 });
    if (url.endsWith('/models')) return list(...models);
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal(init.redirect, 'error');
    assert.equal(init.headers['chatgpt-account-id'], undefined);
    assert.equal(init.method, 'POST');
    const body = JSON.parse(init.body);
    assert.ok(models.includes(body.model));
    requests.push({ auth: init.headers.authorization, body });
    return success();
  };
  async function mount() {
    const { promise, resolve } = Promise.withResolvers();
    const handle = ctx.plugin({ inject: ['llm'], apply: child => { resolve(applyCodexApi(child, mockFetch)); } });
    return { service: await promise, handle };
  }
  const { service, handle: first } = await mount();
  try {
    const add = (key, label) => service.changeApiAccount({ kind: 'add', key, label });
    assert.equal(await add('synthetic-invalid', 'Invalid'), 'invalidKey');
    assert.equal(await add('synthetic-empty', 'Empty'), 'noModels');
    assert.equal(await add('synthetic-work', 'Work'), 'ok');
    assert.equal(await add('synthetic-personal', 'Personal'), 'ok');
    assert.equal(await add('synthetic-work', 'Work duplicate'), 'duplicate');
    const connected = await service.apiAccounts();
    assert.doesNotMatch(JSON.stringify(connected), /synthetic-|authorization/);
    const [work, personal] = connected.accounts;
    for (const account of [work, personal]) {
      assert.match(account.provider, /^codex-api-account-/);
      assert.equal(account.connected, true);
      assert.equal(account.modelCount, 1);
    }
    assert.notEqual(work.provider, personal.provider);
    const query = (provider, model) => ({
      provider, model, maxTokens: 1024, messages: [{ role: 'user', content: [{ type: 'text', text: 'test' }] }],
    });
    for (const [account, model] of [[work, 'gpt-5.3-codex'], [personal, 'gpt-5.2-codex']]) {
      const chunks = await Array.fromAsync(ctx.llm.stream(query(account.provider, model)));
      assert.equal(chunks.at(-1).reason.kind, 'stop', JSON.stringify(chunks));
    }
    assert.deepEqual(requests.map(request => request.auth), ['Bearer synthetic-work', 'Bearer synthetic-personal']);
    assert.equal(requests[0].body.max_output_tokens, 1024);
    await assert.rejects(ctx.llm.prepareCall(query(personal.provider, 'gpt-5.3-codex')), { code: 'UNKNOWN_MODEL' });
    await first.dispose();
    assert.equal(ctx.llm.listProviders().length, 0);

    const { service: restored, handle: second } = await mount();
    try {
      assert.deepEqual(await restored.apiAccounts(), connected);
      keys.delete('Bearer synthetic-work');
      assert.equal(await restored.changeApiAccount({ kind: 'refresh', provider: work.provider }), 'invalidKey');
      assert.equal((await restored.apiAccounts()).accounts.find(account => account.provider === work.provider).connected, false);
      assert.deepEqual(ctx.llm.listProviders().map(provider => provider.id), [personal.provider]);
      assert.equal(await restored.changeApiAccount({ kind: 'remove', provider: work.provider }), 'ok');
      assert.equal(await restored.changeApiAccount({ kind: 'remove', provider: work.provider }), 'notFound');
      assert.doesNotMatch(JSON.stringify([...records.values()]), /synthetic-work/);
      assert.deepEqual((await restored.apiAccounts()).accounts, [personal]);
    } finally {
      await second.dispose();
    }
  } finally {
    await first.dispose();
    await runtime.dispose();
  }
});
