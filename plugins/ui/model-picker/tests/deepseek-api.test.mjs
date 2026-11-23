import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createDeepSeekApi } from '../lib/deepseek-api.js';

function fixture(records) {
  const routes = new Map();
  const effects = [];
  const listeners = new Map();
  const notify = key => listeners.get('credentials/record-updated')?.(key);
  const ctx = {
    credentials: {
      async listRecords() { return [...records.keys()].map(key => ({ key })); },
      async readRecord(key) { return records.get(key); },
      async modifyRecord(key, change) {
        records.set(key, await change(records.get(key)));
        notify(key);
      },
      async deleteRecord(key) {
        if (records.delete(key)) notify(key);
      },
    },
    llm: {
      registerAdapter(providers, adapter) {
        for (const provider of providers) {
          assert.ok(!routes.has(provider), 'route is registered exactly once');
          routes.set(provider, adapter);
        }
        return () => { for (const provider of providers) routes.delete(provider); };
      },
    },
    effect(callback) { effects.push(callback()); },
    on(event, callback) { listeners.set(event, callback); },
    get() { return undefined; },
    emit() {},
  };
  return { routes, api: createDeepSeekApi(ctx), notify, dispose: () => effects.reverse().forEach(effect => effect()) };
}

function answer(model) {
  const events = [
    { type: 'message_start', message: { id: 'fixture', model, usage: { input_tokens: 3, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Fixture account replied.' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 4 } },
    { type: 'message_stop' },
  ];
  return new Response(events.map(event => 'data: ' + JSON.stringify(event) + '\n\n').join(''),
    { headers: { 'content-type': 'text/event-stream' } });
}

test('named DeepSeek credentials and official Messages routes remain independent across refresh and restart', async t => {
  const oldHome = process.env.DSH_HOME;
  const home = await mkdtemp(join(tmpdir(), 'dsh-picker-api-test-'));
  process.env.DSH_HOME = home;
  t.after(async () => {
    if (oldHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = oldHome;
    await rm(home, { recursive: true, force: true });
  });

  const secretModels = new Map([['personal-fixture', 'deepseek-flash'], ['work-fixture', 'deepseek-v4-pro']]);
  const probes = [];
  const records = new Map([['unrelated/account', { kind: 'grant', payload: 'external-fixture' }]]);
  const observed = [];
  t.mock.method(globalThis, 'fetch', async (input, options) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const headers = new Headers(input instanceof Request ? input.headers : options?.headers);
    const key = headers.get('x-api-key');
    const model = secretModels.get(key);
    assert.equal(url.origin, 'https://api.deepseek.com');
    if (!model) return new Response(null, { status: 401 });
    if (url.pathname === '/models') {
      probes.push(key);
      assert.equal(options.redirect, 'error');
      return Response.json({ data: [{ id: model, input_modalities: ['text'], api_capabilities: { anthropic_messages: {} } }] });
    }
    assert.equal(url.pathname, '/anthropic/v1/messages');
    const body = JSON.parse(input instanceof Request ? await input.text() : options.body);
    assert.equal(body.model, model);
    observed.push({ key, model });
    return answer(model);
  });

  const app = fixture(records);
  assert.equal(await app.api.changeApiAccount({ kind: 'add', label: 'Invalid', key: 'invalid-fixture' }), 'invalidKey');
  assert.equal(records.size, 1);
  assert.equal(await app.api.changeApiAccount({ kind: 'add', label: 'Personal', key: 'personal-fixture' }), 'ok');
  assert.equal(await app.api.changeApiAccount({ kind: 'add', label: 'Work', key: 'work-fixture' }), 'ok');
  assert.equal(await app.api.changeApiAccount({ kind: 'add', label: 'Work', key: 'another-fixture' }), 'duplicate');
  assert.deepEqual(probes, ['personal-fixture', 'work-fixture']);

  const projection = await app.api.apiAccounts();
  assert.doesNotMatch(JSON.stringify(projection), /fixture/);
  const personal = projection.accounts.find(account => account.label === 'Personal');
  const work = projection.accounts.find(account => account.label === 'Work');
  assert.match(personal.provider, /^deepseek-api-account-/);
  assert.notEqual(personal.provider, work.provider);
  assert.equal(personal.modelCount, 1);
  assert.equal(work.modelCount, 1);
  const before = app.routes.get(work.provider);
  assert.equal(await app.api.changeApiAccount({ kind: 'refresh', provider: work.provider }), 'ok');
  assert.equal(app.routes.get(work.provider), before);
  await assert.rejects(before.prepareCall(work.provider, 'deepseek-flash'), { code: 'UNKNOWN_MODEL' });
  for (const [account, model] of [[personal, 'deepseek-flash'], [work, 'deepseek-v4-pro']]) {
    const adapter = app.routes.get(account.provider);
    assert.equal(adapter.providerInfo(account.provider).name, 'DeepSeek · ' + account.label);
    assert.deepEqual((await adapter.listModels(account.provider)).map(entry => entry.id), [model]);
    const prepared = await adapter.prepareCall(account.provider, model);
    const chunks = await Array.fromAsync(prepared.stream({
      provider: account.provider, model, messages: [{ role: 'user', content: [{ type: 'text', text: 'Fixture' }] }],
    }));
    assert.equal(chunks.at(-1).reason.kind, 'stop');
  }
  assert.deepEqual(observed, [
    { key: 'personal-fixture', model: 'deepseek-flash' },
    { key: 'work-fixture', model: 'deepseek-v4-pro' },
  ]);
  app.dispose();
  assert.equal(app.routes.size, 0);

  const restarted = fixture(records);
  t.after(restarted.dispose);
  assert.deepEqual(await restarted.api.apiAccounts(), projection);
  const beforeRotation = await restarted.routes.get(personal.provider).prepareCall(personal.provider, 'deepseek-flash');
  const captured = restarted.routes.get(work.provider);
  const key = 'dsh-model-picker/' + personal.provider;
  records.set(key, { kind: 'grant', payload: { version: 1, label: 'Personal', key: 'rotated-fixture' } });
  secretModels.set('rotated-fixture', 'deepseek-v4-pro');
  restarted.notify(key);
  assert.ok(!restarted.routes.has(personal.provider));
  assert.equal(restarted.routes.get(work.provider), captured);
  await assert.rejects(Array.fromAsync(beforeRotation.stream({
    provider: personal.provider, model: 'deepseek-flash',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Fixture' }] }],
  })), { code: 'ABORTED' });
  assert.equal((await restarted.api.apiAccounts()).accounts.find(account => account.provider === personal.provider).connected, true);
  assert.deepEqual((await restarted.routes.get(personal.provider).listModels(personal.provider)).map(model => model.id), ['deepseek-v4-pro']);
  assert.equal(await restarted.api.changeApiAccount({ kind: 'remove', provider: personal.provider }), 'ok');
  assert.ok(!restarted.routes.has(personal.provider));
  assert.ok(restarted.routes.has(work.provider));
  assert.equal(records.size, 2);
  assert.ok(records.has('unrelated/account'));
  records.delete('dsh-model-picker/' + work.provider);
  restarted.notify('dsh-model-picker/' + work.provider);
  assert.ok(!restarted.routes.has(work.provider));
  assert.deepEqual((await restarted.api.apiAccounts()).accounts, []);
});
