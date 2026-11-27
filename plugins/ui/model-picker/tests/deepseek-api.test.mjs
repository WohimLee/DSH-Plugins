import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { Context } from '@deepseek-ai/cordis';
import { createUserMessage, LlmRuntime, resolveRetryPolicy } from '@deepseek-ai/dsh-llm';
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

function sse(events) {
  return new Response(events.map(event => 'data: ' + JSON.stringify(event) + '\n\n').join(''),
    { headers: { 'content-type': 'text/event-stream' } });
}

function answer(model) {
  return sse([
    { type: 'message_start', message: { id: 'fixture', model, usage: { input_tokens: 3, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Fixture account replied.' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 4 } },
    { type: 'message_stop' },
  ]);
}

async function isolateHome(t) {
  const oldHome = process.env.DSH_HOME;
  const home = await mkdtemp(join(tmpdir(), 'dsh-picker-api-test-'));
  process.env.DSH_HOME = home;
  t.after(async () => {
    if (oldHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = oldHome;
    await rm(home, { recursive: true, force: true });
  });
}

const listing = model => Response.json({ data: [{ id: model, input_modalities: ['text'], api_capabilities: { anthropic_messages: {} } }] });

test('named DeepSeek credentials and official Messages routes remain independent across refresh and restart', async t => {
  await isolateHome(t);
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
      return listing(model);
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

test('named DeepSeek requests carry their bounded retry policy and safe terminal failures through the host runtime', async t => {
  await isolateHome(t);
  const ctx = new Context();
  const runtime = ctx.plugin(LlmRuntime);
  const records = new Map();
  ctx.provide('credentials', {
    async listRecords() { return []; },
    async modifyRecord(key, change) { records.set(key, await change(records.get(key))); },
  });
  const started = Promise.withResolvers();
  const accountManager = ctx.plugin({ inject: ['llm', 'credentials'], apply: child => started.resolve(createDeepSeekApi(child)) });
  t.after(async () => {
    await accountManager.dispose();
    await runtime.dispose();
  });
  const model = 'deepseek-flash';
  const key = '01234567-89ab-cdef-0123-456789abcdef';
  const requestId = '12345678-abcd-1234-abcd-123456789abc';
  const echo = `upstream echo of ${key} and private fixture prompt`;
  const messageStart = { type: 'message_start', message: { id: 'fixture', model, usage: { input_tokens: 3 } } };
  const block = { type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'Uncommitted partial text' } };
  const errorEvent = type => ({ type: 'error', error: { type, message: echo } });
  const responses = [
    // A gateway's text/HTML body does not obscure its HTTP status.
    [() => new Response(echo, { status: 503, headers: { 'retry-after': '1.5', 'x-request-id': requestId } }), 'SERVER', true, 503, 1500, requestId],
    [() => new Response(echo, { status: 408 }), 'HTTP_408', true, 408],
    [() => Response.json(errorEvent('rate_limit_error'), { status: 429, headers: { 'x-request-id': key } }), 'RATE_LIMIT', true, 429],
    [() => sse([messageStart, block, errorEvent('overloaded_error')]), 'SERVER', true],
    [() => sse([messageStart, block]), 'STREAM_CLOSED', true],
    [() => { throw new TypeError(echo); }, 'TRANSPORT', true],
    [() => Response.json(errorEvent('authentication_error'), { status: 401 }), 'AUTH', false, 401],
    [() => Response.json(errorEvent('permission_error'), { status: 403 }), 'AUTH', false, 403],
    [() => Response.json({ error: { type: 'rate_limit_error', code: 'insufficient_quota', message: echo } }, { status: 429 }), 'QUOTA', false, 429],
    [() => sse([messageStart, errorEvent('invalid_request_error')]), 'INVALID_REQUEST', false],
    [() => sse([messageStart, {
      type: 'message_delta', delta: { stop_reason: 'refusal', stop_details: { explanation: echo } },
    }, { type: 'message_stop' }]), 'CONTENT_REFUSED', false],
    [() => sse([messageStart, { type: 'message_delta', delta: { stop_reason: echo } }]), 'MALFORMED_RESPONSE', false],
  ];
  let inflight;
  const fetch = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(new Headers(options.headers).get('x-api-key'), key);
    if (String(url) === 'https://api.deepseek.com/models') return listing(model);
    assert.equal(url, 'https://api.deepseek.com/anthropic/v1/messages');
    return inflight(options.signal);
  });
  const app = await started.promise;
  assert.equal(await app.changeApiAccount({ kind: 'add', label: 'Fixture', key }), 'ok');
  const { provider } = (await app.apiAccounts()).accounts[0];
  const request = { provider, model, messages: [{ role: 'user', content: [{ type: 'text', text: 'Fixture' }] }] };
  const { retryableCodes, ...standard } = resolveRetryPolicy();
  for (const [response, code, eligible, status, providerRetryAfterMs, id] of responses) {
    inflight = response;
    const prepared = await ctx.llm.prepareCall(request);
    assert.deepEqual(prepared.retryPolicy, ctx.llm.providerRetryPolicy(provider));
    const { retryableCodes: codes, ...settings } = prepared.retryPolicy;
    assert.deepEqual(settings, standard);
    for (const existing of retryableCodes) assert.ok(codes.includes(existing));
    assert.equal(codes.includes(code), eligible, code);
    assert.ok(!codes.includes('UNKNOWN'));
    const before = fetch.mock.callCount();
    const chunks = await Array.fromAsync(prepared.stream({ ...request, ...prepared.config }));
    assert.equal(fetch.mock.callCount(), before + 1, 'stream remains one attempt');
    assert.equal(chunks.filter(chunk => chunk.type === 'finish').length, 1);
    const reason = chunks.at(-1).reason;
    assert.equal(reason.kind, 'error');
    assert.equal(reason.failure.code, code);
    assert.equal(reason.failure.status, status);
    assert.equal(reason.failure.providerRetryAfterMs, providerRetryAfterMs);
    assert.equal(reason.failure.requestId, id);
    assert.ok(!JSON.stringify(reason).includes(key));
    assert.doesNotMatch(JSON.stringify(reason), /private fixture prompt/);
    if (code === 'STREAM_CLOSED' || code === 'SERVER' && status === undefined) {
      assert.ok(chunks.some(chunk => chunk.type === 'text-delta' && chunk.text === 'Uncommitted partial text'));
    }
  }
  const controller = new AbortController();
  const entered = Promise.withResolvers();
  inflight = signal => new Promise((_, reject) => {
    entered.resolve();
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
  const beforeAbort = fetch.mock.callCount();
  const interrupted = Array.fromAsync(ctx.llm.stream({ ...request, signal: controller.signal }));
  await entered.promise;
  controller.abort();
  const aborted = (await interrupted).at(-1).reason;
  assert.equal(aborted.kind, 'aborted');
  assert.equal(aborted.failure.code, 'ABORTED');
  assert.ok(!ctx.llm.providerRetryPolicy(provider).retryableCodes.includes('ABORTED'));
  assert.equal(fetch.mock.callCount(), beforeAbort + 1);

  inflight = () => answer(model);
  const chunks = await Array.fromAsync(ctx.llm.stream(request));
  assert.equal(chunks.at(-1).reason.kind, 'stop');
});

test('the rc.5 agent loop retries named DeepSeek 408 and premature EOF without running a completed tool again', { timeout: 5000 }, async t => {
  await isolateHome(t);
  // Resolve the pinned CLI's public runtime modules, not another plugin's fixtures or internals.
  const host = createRequire(import.meta.resolve('@deepseek-ai/dsh/package.json'));
  const [Session, Projections, Prompt, Tools, Executor, Agents, Retry, Loop] = await Promise.all([
    'session', 'session-projection', 'system-prompt', 'tools', 'tool-executor-native', 'agent', 'llm-retry', 'agent-loop',
  ].map(name => import(pathToFileURL(host.resolve(`@deepseek-ai/dsh-${name}`)).href)));
  const ctx = new Context();
  t.after(() => ctx.fiber.dispose());
  for (const plugin of [LlmRuntime, Session.default, Projections.default, Prompt.default, Tools.default, Executor,
    Agents.default, Retry, Loop.default]) await ctx.plugin(plugin);
  ctx.provide('credentials', { async listRecords() { return []; }, async modifyRecord(_key, change) { await change(); } });
  const manager = createDeepSeekApi(ctx);

  const model = 'deepseek-flash';
  const key = 'synthetic-deepseek-agent-key';
  const tool = 'record_once';
  const callId = 'call-original';
  const toolOutput = 'synthetic tool finished';
  const executions = [];
  const requests = [];
  const start = { type: 'message_start', message: { id: 'fixture', model, usage: { input_tokens: 3 } } };
  const block = content_block => ({ type: 'content_block_start', index: 0, content_block });
  const responses = [
    () => sse([start, block({ type: 'tool_use', name: tool, id: callId, input: {} }),
      { type: 'content_block_stop', index: 0 }, { type: 'message_delta', delta: { stop_reason: 'tool_use' } }, { type: 'message_stop' }]),
    () => new Response(`private echo ${key}`, { status: 408, headers: { 'retry-after': '0.001' } }),
    () => sse([start, block({ type: 'text', text: 'discard partial text' })]),
    () => answer(model),
  ];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(new Headers(options.headers).get('x-api-key'), key);
    if (String(url) === 'https://api.deepseek.com/models') return listing(model);
    assert.equal(url, 'https://api.deepseek.com/anthropic/v1/messages');
    requests.push(JSON.parse(options.body));
    return responses[requests.length - 1]?.() ?? new Response(null, { status: 401 });
  });
  assert.equal(await manager.changeApiAccount({ kind: 'add', label: 'Agent recovery fixture', key }), 'ok');
  const { provider } = (await manager.apiAccounts()).accounts[0];
  ctx.tools.register(Tools.defineTool({
    name: tool, description: 'Record a synthetic side effect', parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(_args, run) { executions.push(run.callId); return toolOutput; },
  }));
  const agent = await ctx.agentLoop.create('deepseek-recovery', { provider, model });
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Run the fixture tool and reply.' }], source: { kind: 'user' } }));
  await agent.whenIdle();

  const events = agent.session.snapshotEvents();
  assert.equal(events.at(-1)?.type, 'turn/end');
  assert.deepEqual(events.at(-1).data.reason, { kind: 'completed' });
  const retries = events.filter(event => event.type === 'llm/retry');
  assert.deepEqual(retries.map(({ data }) => [data.turn, data.step, data.provider, data.retry, data.failure.code]),
    [[1, 2, provider, 1, 'HTTP_408'], [1, 2, provider, 2, 'STREAM_CLOSED']]);
  assert.equal(events.filter(event => event.type === 'llm/retry-started').length, 2);
  const results = events.filter(event => event.type === 'tool/result');
  assert.equal(results.length, 1);
  assert.ok(results[0].seq < retries[0].seq);
  assert.deepEqual(executions, [callId]);
  assert.equal(requests.length, 4);
  assert.deepEqual(requests[2], requests[1]);
  assert.deepEqual(requests[3], requests[1]);
  assert.deepEqual(requests[1].messages.flatMap(message => message.content).filter(block => block.type === 'tool_result'), [
    { type: 'tool_result', tool_use_id: callId, content: [{ type: 'text', text: toolOutput }], is_error: false },
  ]);
  const history = agent.session.deriveMessages();
  assert.deepEqual(history.at(-1).content, [{ type: 'text', text: 'Fixture account replied.' }]);
  assert.doesNotMatch(JSON.stringify(history), /discard partial text/);
  assert.doesNotMatch(JSON.stringify(events), /private echo|synthetic-deepseek-agent-key/);
});
