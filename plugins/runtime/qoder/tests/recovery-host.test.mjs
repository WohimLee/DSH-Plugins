import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { Context } from '@deepseek-ai/cordis';
import { createUserMessage, LlmRuntime } from '@deepseek-ai/dsh-llm';
import { QoderAdapter } from '../lib/index.js';

// Exercise the pinned CLI's public runtime modules without installing a bundle.
const host = createRequire(import.meta.resolve('@deepseek-ai/dsh/package.json'));
const [AgentLoop, AgentRegistry, SessionStore, SessionProjectionRegistry, SystemPrompt, Tools, NativeToolExecutor, LlmRetry] =
  await Promise.all(['agent-loop', 'agent', 'session', 'session-projection', 'system-prompt', 'tools', 'tool-executor-native', 'llm-retry']
    .map(name => import(pathToFileURL(host.resolve(`@deepseek-ai/dsh-${name}`)).href)));

const callId = 'call-original';
const stagedId = 'call-uncommitted';
const toolOutput = 'synthetic tool output';
const result = fields => ({ type: 'result', subtype: 'success', is_error: false, ...fields });
const proposedTool = id => ({ type: 'assistant', message: { content: [
  { type: 'tool_use', name: 'mcp__dsh__tool_1', id, input: {} },
] } });
const failed = (error_code, error_message = 'synthetic-private-upstream') => result({
  subtype: 'error_during_execution', is_error: true, error_code, error_message, errors: [],
});
const partial = { type: 'stream_event', event: { type: 'content_block_delta', index: 0,
  delta: { type: 'text_delta', text: 'discarded partial' },
} };

async function run(t, replies, { cancel = false } = {}) {
  const ctx = new Context();
  t.after(() => ctx.fiber.dispose());
  for (const plugin of [LlmRuntime, SessionStore.default, SessionProjectionRegistry.default,
    SystemPrompt.default, Tools.default, NativeToolExecutor, AgentRegistry.default, LlmRetry, AgentLoop.default]) {
    await ctx.plugin(plugin);
  }
  const executions = [];
  const inputs = [];
  const directories = [];
  let closed = 0;
  const adapter = new QoderAdapter({ cliPath: process.execPath }, async (_executable, input, options) => {
    assert.equal(closed, inputs.length, 'prev SDK session closes before another attempt');
    const [message] = await Array.fromAsync(input);
    inputs.push(JSON.parse(message.message.content));
    directories.push(options.cwd);
    assert.deepEqual(options.tools, []);
    assert.equal(options.maxTurns, 1);
    assert.equal(options.persistSession, false);
    const frames = replies[inputs.length - 1] ?? [failed(401)];
    return { events: (async function* () { yield* frames; })(), async close() { closed++; } };
  }, async () => [{ value: 'lite' }], async () => undefined);
  ctx.effect(() => () => adapter.dispose());
  ctx.llm.registerAdapter(['qoder'], adapter);
  ctx.tools.register(Tools.defineTool({
    name: 'record_once', description: 'Record a synthetic side effect', parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(_args, run) { executions.push(run.callId); return toolOutput; },
  }));
  const agent = await ctx.agentLoop.create('qoder-recovery', { provider: 'qoder', model: 'lite' });
  if (cancel) ctx.on('session/event', (session, event) => {
    if (session === agent.session && event.type === 'llm/retry') queueMicrotask(() => agent.cancel({ kind: 'user' }));
  });
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Run the fixture tool and reply.' }], source: { kind: 'user' } }));
  await agent.whenIdle();
  const events = agent.session.snapshotEvents();
  assert.deepEqual(executions, [callId]);
  assert.equal(inputs.length, closed);
  assert.equal(new Set(directories).size, inputs.length);
  assert.equal(events.filter(event => event.type === 'tool/result').length, 1);
  for (const input of inputs.slice(1)) {
    const toolMessages = input.filter(message => message.role === 'tool');
    assert.equal(toolMessages.length, 1);
    assert.equal(toolMessages[0].toolCallId, callId);
    assert.ok(toolMessages[0].content.some(block => block.text === toolOutput));
  }
  const history = agent.session.deriveMessages();
  assert.doesNotMatch(JSON.stringify(history), /discarded partial|call-uncommitted/);
  assert.doesNotMatch(JSON.stringify(events), /synthetic-private-upstream/);
  assert.equal(events.at(-1)?.type, 'turn/end');
  return { inputs, events, history, end: events.at(-1).data.reason };
}

const toolTurn = [proposedTool(callId), result({ stop_reason: 'tool_use' })];
const transientFailure = [partial, proposedTool(stagedId), failed('503')];

test('rc.5 retries the failed step, not the completed tool; discards failed output and staged tools', { timeout: 5000 }, async t => {
  const { inputs, events, history, end } = await run(t, [toolTurn, transientFailure, [result({ result: 'recovered' })]]);
  assert.equal(inputs.length, 3);
  assert.deepEqual(inputs[1], inputs[2]);
  const scheduled = events.filter(event => event.type === 'llm/retry');
  assert.deepEqual(scheduled.map(({ data }) => [data.turn, data.step, data.provider, data.retry, data.maxRetries, data.failure.code]),
    [[1, 2, 'qoder', 1, 1, 'SERVER']]);
  assert.ok(events.find(event => event.type === 'tool/result').seq < scheduled[0].seq);
  assert.equal(events.filter(event => event.type === 'llm/retry-started').length, 1);
  assert.deepEqual(end, { kind: 'completed' });
  assert.deepEqual(history.at(-1).content, [{ type: 'text', text: 'recovered' }]);
});

test('rc.5 does not replay Qoder after the host retry budget is exhausted', { timeout: 5000 }, async t => {
  const { inputs, events, end } = await run(t, [toolTurn, transientFailure, transientFailure]);
  assert.equal(inputs.length, 3);
  assert.equal(events.filter(event => event.type === 'llm/retry-started').length, 1);
  assert.equal(end.kind, 'error');
  assert.equal(end.error.code, 'SERVER');
});

test('rc.5 starts no new Qoder request if cancelled during backoff', { timeout: 5000 }, async t => {
  const { inputs, events, end } = await run(t, [toolTurn, transientFailure], { cancel: true });
  assert.equal(inputs.length, 2);
  assert.equal(events.filter(event => event.type === 'llm/retry').length, 1);
  assert.equal(events.filter(event => event.type === 'llm/retry-started').length, 0);
  assert.deepEqual(end, { kind: 'aborted', reason: { kind: 'user' } });
});

for (const [frame, expected] of [
  [failed('unrecognized_qoder_code'), 'UNKNOWN'],
  [failed(429, 'quota exhausted'), 'QUOTA'],
  [failed(503, 'Model queue recovery attempts exceeded'), 'QODER_MODEL_QUEUE_EXHAUSTED'],
]) {
  test(`rc.5 stops without retrying ${expected}`, { timeout: 5000 }, async t => {
    const { inputs, events, end } = await run(t, [toolTurn, [frame]]);
    assert.equal(inputs.length, 2);
    assert.equal(events.some(event => event.type === 'llm/retry'), false);
    assert.equal(end.kind, 'error');
    assert.equal(end.error.code, expected);
  });
}
