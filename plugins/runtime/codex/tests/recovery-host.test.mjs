import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire, registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Reuse these scenarios against the package installed by the target CLI as well as local builds.
const plugin = process.env.DSH_CODEX_TEST_INSTALLED_LIB
  ? pathToFileURL(`${await realpath(process.env.DSH_CODEX_TEST_INSTALLED_LIB)}/`) : new URL('../lib/', import.meta.url);
// Use the target CLI's production modules rather than the unpublished agent-loop-testkit.
const host = createRequire(process.env.DSH_CODEX_TEST_CLI
  ? await realpath(process.env.DSH_CODEX_TEST_CLI) : import.meta.resolve('@deepseek-ai/dsh/package.json'));
// Standalone test processes do not run the CLI's profile loader. Provide its host peers
// for imports inside the installed tarball; all other imports resolve normally.
if (process.env.DSH_CODEX_TEST_INSTALLED_LIB) {
  const peers = new Set(['@deepseek-ai/cordis', '@deepseek-ai/dsh-credentials', '@deepseek-ai/dsh-llm', '@deepseek-ai/schemastery']);
  registerHooks({ resolve(specifier, context, nextResolve) {
    if (context.parentURL?.startsWith(plugin.href) && peers.has(specifier)) {
      return nextResolve(pathToFileURL(host.resolve(specifier)).href, context);
    }
    return nextResolve(specifier, context);
  } });
}
const [CodexPlugin, { installNetworkRecovery }, { MODEL_CONNECTION_FAILED }, { applyCodexApi }] = await Promise.all([
  import(new URL('index.js', plugin)), import(new URL('model-network-recovery.js', plugin)), import(new URL('model-network-failure.js', plugin)),
  import(new URL('api.js', plugin)),
]);
const { CodexAdapter, RESPONSES_URL } = CodexPlugin;
const { Context } = await import(pathToFileURL(host.resolve('@deepseek-ai/cordis')).href);
const { createUserMessage, LlmRuntime, resolveRetryPolicy } = await import(pathToFileURL(host.resolve('@deepseek-ai/dsh-llm')).href);
const [AgentLoop, AgentRegistry, SessionStore, SessionProjectionRegistry, SystemPrompt, Tools, NativeToolExecutor, LlmRetry] =
  await Promise.all(['agent-loop', 'agent', 'session', 'session-projection', 'system-prompt', 'tools', 'tool-executor-native', 'llm-retry']
    .map(name => import(pathToFileURL(host.resolve(`@deepseek-ai/dsh-${name}`)).href)));

const toolName = 'record_once';
const callId = 'call-recovery';
const toolOutput = 'tool finished';
const privateEcho = 'synthetic-provider-private-echo';
const toolRequest = { type: 'response.output_item.done', item: {
  type: 'function_call', call_id: callId, name: toolName, arguments: '{}',
} };
const completed = { type: 'response.completed' };
const delta = text => ({ type: 'response.output_text.delta', delta: text });
const failed = code => ({ type: 'response.failed', response: {
  error: { code, message: privateEcho },
} });

async function fixture(t, responses, { exhaust = false, cancel = false, networkClock, unload = false, source = 'user', api = false, unlink = false, nextAccount } = {}) {
  const codexHome = await mkdtemp(join(tmpdir(), 'dsh-codex-recovery-'));
  const ctx = new Context();
  t.after(async () => {
    try { await ctx.fiber.dispose(); }
    finally { await rm(codexHome, { recursive: true, force: true }); }
  });
  const writeAccount = account => writeFile(join(codexHome, 'auth.json'), JSON.stringify({ auth_mode: 'chatgpt',
    tokens: { access_token: 'synthetic-key', account_id: account },
  }));
  await writeAccount('synthetic-account');
  for (const plugin of [LlmRuntime, SessionStore.default, SessionProjectionRegistry.default,
    SystemPrompt.default, Tools.default, NativeToolExecutor, AgentRegistry.default, LlmRetry, AgentLoop.default]) {
    await ctx.plugin(plugin);
  }

  const requests = [];
  const executions = [];
  const model = api ? 'gpt-5.3-codex' : 'synthetic-codex';
  let provider = 'codex';
  let apiService;
  const fetchResponse = async (url, init) => {
    if (api && url === 'https://api.openai.com/v1/models') return Response.json({ data: [{ id: model }] });
    requests.push({ url, body: JSON.parse(init.body), executions: executions.length });
    const events = responses[requests.length - 1];
    // If an extra attempt leaks through, stop immediately and let request-count assertions fail.
    if (events instanceof Error) throw events;
    if (events instanceof Response) return events;
    return events ? new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), {
      headers: { 'content-type': 'text/event-stream' },
    }) : new Response(null, { status: 401 });
  };
  const adapter = new CodexAdapter({ codexHome, models: [{ id: model }] }, fetchResponse);
  let bundle;
  if (api) {
    const records = new Map();
    ctx.provide('credentials', {
      readRecord: async key => records.get(key),
      modifyRecord: async (key, update) => {
        const next = await update(records.get(key));
        if (next) records.set(key, structuredClone(next));
      },
    });
    apiService = applyCodexApi(ctx, fetchResponse);
    assert.equal(await apiService.changeApiAccount({ kind: 'add', key: 'synthetic-api-key', label: 'Test' }), 'ok');
    [{ provider }] = (await apiService.apiAccounts()).accounts;
  }
  if (unload) {
    // Use the real bundle entry and disable its macOS manual-proxy fallback in this test.
    const { DSH_HOME, NO_PROXY } = process.env;
    process.env.DSH_HOME = codexHome;
    process.env.NO_PROXY = '*';
    t.after(() => {
      if (DSH_HOME === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = DSH_HOME;
      if (NO_PROXY === undefined) delete process.env.NO_PROXY; else process.env.NO_PROXY = NO_PROXY;
    });
    t.mock.method(globalThis, 'fetch', fetchResponse);
    bundle = ctx.plugin(CodexPlugin, { codexHome, models: [{ id: model }] });
    await bundle;
  }
  if (exhaust) {
    // Shrink only the retry budget and delay for this test, not the host's retryable-code list.
    adapter.providerRetryPolicy = () => resolveRetryPolicy({ mode: 'normal', maxRetries: 1,
      backoff: { initialDelayMs: 1, maxDelayMs: 1, jitterRatio: 0 },
    });
  }
  if (!bundle && !api) {
    ctx.effect(() => () => adapter.dispose());
    ctx.llm.registerAdapter(['codex'], adapter);
    if (networkClock) installNetworkRecovery(ctx, provider => provider === 'codex' ? adapter.routeSignal : undefined,
      nextAccount ? { ...networkClock, wait: async (ms, signal) => { await writeAccount(nextAccount); await networkClock.wait(ms, signal); } }
        : networkClock);
  }
  ctx.tools.register(Tools.defineTool({
    name: toolName,
    description: 'Record one synthetic side effect',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(_args, run) { executions.push(run.callId); return toolOutput; },
  }));
  const agent = await ctx.agentLoop.create('codex-recovery', { provider, model });
  let removed;
  if (cancel || unload || unlink) {
    ctx.on('session/event', (session, event) => {
      // Let the retry handler arm its timer, then cancel before it can dispatch.
      if (session !== agent.session || event.type !== 'llm/retry') return;
      queueMicrotask(() => {
        if (bundle) void bundle.dispose();
        else if (unlink) removed = apiService.changeApiAccount({ kind: 'remove', provider });
        else agent.cancel({ kind: 'user' });
      });
    });
  }
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Run the tool and reply.' }], source: { kind: source } }));
  await agent.whenIdle();
  if (unlink) assert.equal(await removed, 'ok');
  return { agent, provider, requests, executions, events: agent.session.snapshotEvents() };
}

function assertSingleTool({ requests, executions, events }, expectedRequests, url = RESPONSES_URL) {
  assert.equal(requests.length, expectedRequests, JSON.stringify(events.at(-1)?.data));
  assert.deepEqual(executions, [callId]);
  assert.deepEqual(requests.map(request => request.url), Array(expectedRequests).fill(url));
  assert.deepEqual(requests.map(request => request.executions), [0, ...Array(expectedRequests - 1).fill(1)]);
  assert.deepEqual(requests[0].body.input.filter(item => item.type === 'function_call_output'), []);
  for (const { body } of requests.slice(1)) {
    assert.deepEqual(body.input.filter(item => item.type === 'function_call_output'), [
      { type: 'function_call_output', call_id: callId, output: toolOutput },
    ]);
  }
  assert.deepEqual(events.filter(event => event.type === 'step/start').map(({ data }) => [data.turn, data.step]), [[1, 1], [1, 2]]);
  assert.equal(events.filter(event => event.type === 'tool/result').length, 1);
  assert.doesNotMatch(JSON.stringify(events), new RegExp(privateEcho));
}

function turnEnd(events) {
  const end = events.at(-1);
  assert.equal(end?.type, 'turn/end');
  return end.data.reason;
}

function assertServerRetry(events, { started = true } = {}) {
  const retries = events.filter(event => event.type === 'llm/retry');
  assert.deepEqual(retries.map(({ data }) => [data.turn, data.step, data.provider, data.mode, data.retry, data.failure.code]),
    [[1, 2, 'codex', 'normal', 1, 'SERVER']]);
  assert.ok(events.find(event => event.type === 'tool/result').seq < retries[0].seq);
  assert.deepEqual(events.filter(event => event.type === 'llm/retry-started').map(({ data }) => data.retryId),
    started ? [retries[0].data.retryId] : []);
}

test('Codex server_error retries the same request after a completed tool, then finishes the turn', { timeout: 5000 }, async t => {
  const result = await fixture(t, [[toolRequest, completed], [delta('discard this'), failed('server_error')],
    [delta('recovered'), completed]]);
  const { requests, events, agent } = result;
  assertSingleTool(result, 3);
  assertServerRetry(events);
  assert.deepEqual(requests[2].body, requests[1].body);
  assert.deepEqual(turnEnd(events), { kind: 'completed' });
  const messages = agent.session.deriveMessages();
  assert.equal(messages.at(-1).role, 'assistant');
  assert.deepEqual(messages.at(-1).content, [{ type: 'text', text: 'recovered' }]);
  assert.doesNotMatch(JSON.stringify(messages), /discard this/);
});

test('Codex keeps the completed tool when the transient retry budget is exhausted', { timeout: 5000 }, async t => {
  const result = await fixture(t, [[toolRequest, completed], [failed('server_error')], [failed('server_error')]], { exhaust: true });
  const { events } = result;
  assertSingleTool(result, 3);
  assertServerRetry(events);
  const reason = turnEnd(events);
  assert.equal(reason.kind, 'error');
  assert.equal(reason.error.code, 'SERVER');
});

for (const [code, expected] of [['invalid_api_key', 'AUTH'], ['unrecognized_provider_code', 'UNKNOWN']]) {
  test(`Codex ${code} stops after the first failed request without retrying the completed tool`, { timeout: 5000 }, async t => {
    const result = await fixture(t, [[toolRequest, completed], [failed(code)]]);
    const { events } = result;
    assertSingleTool(result, 2);
    assert.equal(events.some(event => event.type === 'llm/retry'), false);
    const reason = turnEnd(events);
    assert.equal(reason.kind, 'error');
    assert.equal(reason.error.code, expected);
  });
}

test('Codex cancellation during retry backoff prevents another request or tool execution', { timeout: 5000 }, async t => {
  const result = await fixture(t, [[toolRequest, completed], [failed('server_error')]], { cancel: true });
  const { events } = result;
  assertSingleTool(result, 2);
  assertServerRetry(events, { started: false });
  assert.deepEqual(turnEnd(events), { kind: 'aborted', reason: { kind: 'user' } });
});

function connectionFailure(code = 'ENETUNREACH') {
  return new TypeError('fetch failed', { cause: Object.assign(new Error(privateEcho), { code, syscall: 'connect' }) });
}

function fakeClock({ jump = 0, hold = false } = {}) {
  let now = 1_000;
  const delays = [];
  return {
    delays, now: () => now,
    async wait(ms, signal) {
      delays.push(ms);
      if (hold) return new Promise((_, reject) => {
        if (signal.aborted) reject(signal.reason);
        else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
      now += ms + jump;
    },
  };
}

function networkRetries(events) {
  return events.filter(({ type, data }) => type === 'llm/retry' && data.failure.code === MODEL_CONNECTION_FAILED);
}

function assertNetworkWaits(events, delays, started = delays.length, provider = 'codex') {
  const waits = networkRetries(events);
  assert.deepEqual(waits.map(({ data }) => [data.turn, data.step, data.provider, data.retry, data.delayMs]),
    delays.map((ms, index) => [1, 2, provider, index + 1, ms]));
  assert.equal(new Set(waits.map(({ data }) => data.retryId)).size, 1);
  assert.deepEqual(events.filter(({ type, data }) => type === 'llm/retry-started' && data.retryId === waits[0].data.retryId)
    .map(({ data }) => data.retry), Array.from({ length: started }, (_, index) => index + 1));
}

test('scheduled turns recover without spending the ordinary budget or replaying the completed tool', { timeout: 5000 }, async t => {
  const clock = fakeClock();
  const result = await fixture(t, [[toolRequest, completed], ...Array.from({ length: 6 }, () => connectionFailure()),
    [failed('server_error')], [delta('recovered after network'), completed]], { exhaust: true, networkClock: clock, source: 'schedule' });
  const { events, requests } = result;
  assertSingleTool(result, 9);
  assertNetworkWaits(events, [5000, 10000, 20000, 40000, 60000, 60000]);
  assert.deepEqual(events.filter(({ type, data }) => type === 'llm/retry' && data.failure.code === 'SERVER')
    .map(({ data }) => [data.retry, data.maxRetries]), [[1, 1]]);
  for (const { body } of requests.slice(2)) assert.deepEqual(body, requests[1].body);
  assert.deepEqual(turnEnd(events), { kind: 'completed' });
});

test('ordinary attempts before and after a network wait share the same ordinary budget', { timeout: 5000 }, async t => {
  const result = await fixture(t, [[toolRequest, completed], [failed('server_error')], connectionFailure(), [failed('server_error')]], {
    exhaust: true, networkClock: fakeClock(),
  });
  assertSingleTool(result, 4);
  assertNetworkWaits(result.events, [5000]);
  assert.deepEqual(result.events.filter(({ type, data }) => type === 'llm/retry' && data.failure.code === 'SERVER')
    .map(({ data }) => [data.retry, data.maxRetries]), [[1, 1]]);
  assert.equal(turnEnd(result.events).error?.code, 'SERVER');
});

test('wake after the wall-clock deadline does not resend or enter ordinary retry', { timeout: 5000 }, async t => {
  const result = await fixture(t, [[toolRequest, completed], connectionFailure()], { networkClock: fakeClock({ jump: 600_000 }) });
  assertSingleTool(result, 2);
  assertNetworkWaits(result.events, [5000], 0);
  assert.equal(result.events.filter(event => event.type === 'llm/retry').length, 1);
  const reason = turnEnd(result.events);
  assert.equal(reason.kind, 'error');
  assert.equal(reason.error.code, 'TRANSPORT');
  assert.match(reason.error.message, /10 分钟/);
});

test('last network delay is clipped to the 10-minute deadline and never starts a request', { timeout: 5000 }, async t => {
  const delays = [5000, 10000, 20000, 40000, ...Array(8).fill(60000), 45000];
  const result = await fixture(t, [[toolRequest, completed], ...delays.map(() => connectionFailure())], { networkClock: fakeClock() });
  assertSingleTool(result, 14);
  assertNetworkWaits(result.events, delays, 12);
  assert.equal(turnEnd(result.events).error?.code, 'TRANSPORT');
});

test('user cancellation interrupts the pending connection wait without resending', { timeout: 5000 }, async t => {
  const result = await fixture(t, [[toolRequest, completed], connectionFailure()], {
    networkClock: fakeClock({ hold: true }), cancel: true,
  });
  assertSingleTool(result, 2);
  assertNetworkWaits(result.events, [5000], 0);
  assert.deepEqual(turnEnd(result.events), { kind: 'aborted', reason: { kind: 'user' } });
});

test('unloading the actual Codex bundle interrupts a pending wait and removes its route', { timeout: 3500 }, async t => {
  const result = await fixture(t, [[toolRequest, completed], connectionFailure()], { unload: true });
  assertSingleTool(result, 2);
  assertNetworkWaits(result.events, [5000], 0);
  assert.equal(turnEnd(result.events).kind, 'error');
  assert.equal(result.agent.ctx.llm.listProviders().some(({ id }) => id === 'codex'), false);
});

test('a response-body error and an ambiguous fetch rejection do not enter network wait', { timeout: 5000 }, async t => {
  const bodyError = new Response(new ReadableStream({ start(controller) { controller.error(connectionFailure()); } }));
  const result = await fixture(t, [[toolRequest, completed], bodyError, connectionFailure('ECONNRESET'), [delta('recovered'), completed]], {
    networkClock: fakeClock(),
  });
  assertSingleTool(result, 4);
  assert.deepEqual(result.events.filter(event => event.type === 'llm/retry').map(({ data }) => [data.retry, data.failure.code]),
    [[1, 'TRANSPORT'], [2, 'TRANSPORT']]);
  assert.deepEqual(turnEnd(result.events), { kind: 'completed' });
});

const openAiResponses = 'https://api.openai.com/v1/responses';

test('OpenAI API safely resumes the same request after a connection failure', { timeout: 12000 }, async t => {
  const result = await fixture(t, [[toolRequest, completed], connectionFailure(), [delta('recovered'), completed]], { api: true });
  assertSingleTool(result, 3, openAiResponses);
  assertNetworkWaits(result.events, [5000], 1, result.provider);
  assert.deepEqual(result.requests[1].body, result.requests[2].body);
  assert.deepEqual(turnEnd(result.events), { kind: 'completed' });
});

test('unlinking the OpenAI API account interrupts network wait without resending', { timeout: 3500 }, async t => {
  const result = await fixture(t, [[toolRequest, completed], connectionFailure()], { api: true, unlink: true });
  assertSingleTool(result, 2, openAiResponses);
  assertNetworkWaits(result.events, [5000], 0, result.provider);
  assert.equal(result.agent.ctx.llm.listProviders().some(({ id }) => id === result.provider), false);
});


test('a changed Desktop login never receives the prior account’s pending request', { timeout: 5000 }, async t => {
  const result = await fixture(t, [[toolRequest, completed], connectionFailure()], {
    networkClock: fakeClock(), nextAccount: 'different-synthetic-account',
  });
  assertSingleTool(result, 2);
  assertNetworkWaits(result.events, [5000]);
  assert.equal(turnEnd(result.events).error?.code, 'AUTH');
  assert.doesNotMatch(JSON.stringify(result.events), /different-synthetic-account/);
});
