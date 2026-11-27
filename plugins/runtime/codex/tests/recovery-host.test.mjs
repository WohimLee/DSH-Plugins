import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Context } from '@deepseek-ai/cordis';
import { createUserMessage, LlmRuntime, resolveRetryPolicy } from '@deepseek-ai/dsh-llm';
import { CodexAdapter, RESPONSES_URL } from '../lib/index.js';

// Use the pinned CLI's production modules rather than the unpublished agent-loop-testkit.
const host = createRequire(import.meta.resolve('@deepseek-ai/dsh/package.json'));
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

async function fixture(t, responses, { exhaust = false, cancel = false } = {}) {
  const codexHome = await mkdtemp(join(tmpdir(), 'dsh-codex-recovery-'));
  const ctx = new Context();
  t.after(async () => {
    try { await ctx.fiber.dispose(); }
    finally { await rm(codexHome, { recursive: true, force: true }); }
  });
  await writeFile(join(codexHome, 'auth.json'), JSON.stringify({ auth_mode: 'chatgpt',
    tokens: { access_token: 'synthetic-key', account_id: 'synthetic-account' },
  }));
  for (const plugin of [LlmRuntime, SessionStore.default, SessionProjectionRegistry.default,
    SystemPrompt.default, Tools.default, NativeToolExecutor, AgentRegistry.default, LlmRetry, AgentLoop.default]) {
    await ctx.plugin(plugin);
  }

  const requests = [];
  const executions = [];
  const model = 'synthetic-codex';
  const adapter = new CodexAdapter({ codexHome, models: [{ id: model }] }, async (url, init) => {
    requests.push({ url, body: JSON.parse(init.body), executions: executions.length });
    const events = responses[requests.length - 1];
    // If an extra attempt leaks through, stop immediately and let request-count assertions fail.
    return events ? new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), {
      headers: { 'content-type': 'text/event-stream' },
    }) : new Response(null, { status: 401 });
  });
  if (exhaust) {
    // Shrink only the retry budget and delay for this test, not the host's retryable-code list.
    adapter.providerRetryPolicy = () => resolveRetryPolicy({ mode: 'normal', maxRetries: 1,
      backoff: { initialDelayMs: 1, maxDelayMs: 1, jitterRatio: 0 },
    });
  }
  ctx.effect(() => () => adapter.dispose());
  ctx.llm.registerAdapter(['codex'], adapter);
  ctx.tools.register(Tools.defineTool({
    name: toolName,
    description: 'Record one synthetic side effect',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(_args, run) { executions.push(run.callId); return toolOutput; },
  }));
  const agent = await ctx.agentLoop.create('codex-recovery', { provider: 'codex', model });
  if (cancel) {
    ctx.on('session/event', (session, event) => {
      // Let the retry handler arm its timer, then cancel before it can dispatch.
      if (session === agent.session && event.type === 'llm/retry') queueMicrotask(() => agent.cancel({ kind: 'user' }));
    });
  }
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Run the tool and reply.' }], source: { kind: 'user' } }));
  await agent.whenIdle();
  return { agent, requests, executions, events: agent.session.snapshotEvents() };
}

function assertSingleTool({ requests, executions, events }, expectedRequests) {
  assert.equal(requests.length, expectedRequests, JSON.stringify(events.at(-1)?.data));
  assert.deepEqual(executions, [callId]);
  assert.deepEqual(requests.map(request => request.url), Array(expectedRequests).fill(RESPONSES_URL));
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
