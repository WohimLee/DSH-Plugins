import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { Context } from '@deepseek-ai/cordis';
import { createUserMessage, LlmRuntime } from '@deepseek-ai/dsh-llm';
import { InMemoryCredentialStore, defaultProviderAuthContext } from '@earendil-works/pi-ai';
import { GrokAdapter } from '../lib/index.js';
import { grokProvider, readCatalog } from '../lib/catalog.js';
import { grokRetryPolicy } from '../lib/recovery.js';

const host = createRequire(import.meta.resolve('@deepseek-ai/dsh/package.json'));
const [AgentLoop, AgentRegistry, SessionStore, SessionProjectionRegistry, SystemPrompt, Tools, NativeToolExecutor, LlmRetry] =
  await Promise.all(['agent-loop', 'agent', 'session', 'session-projection', 'system-prompt', 'tools', 'tool-executor-native', 'llm-retry']
    .map(name => import(pathToFileURL(host.resolve(`@deepseek-ai/dsh-${name}`)).href)));

const frame = (type, fields) => ({ type, ...fields });
const sse = (...events) => new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), {
  headers: { 'content-type': 'text/event-stream' },
});
const completed = output => frame('response.completed', { response: { id: 'fixture', status: 'completed', output } });
const model = 'grok-recovery-fixture';
const toolName = 'record_once';
const toolCall = id => ({ type: 'function_call', id, call_id: id, name: toolName, arguments: '{}', status: 'completed' });
const outputItem = (type, item) => frame(`response.output_item.${type}`, { item });

async function run(t, errorCode) {
  const ctx = new Context();
  t.after(() => ctx.fiber.dispose());
  for (const plugin of [LlmRuntime, SessionStore.default, SessionProjectionRegistry.default,
    SystemPrompt.default, Tools.default, NativeToolExecutor, AgentRegistry.default, LlmRetry, AgentLoop.default]) await ctx.plugin(plugin);
  const lifetime = new AbortController();
  t.after(() => lifetime.abort());
  const catalog = await readCatalog('fixture', lifetime.signal, async url => url.endsWith('/language-models')
    ? Response.json({ models: [{ id: model, output_modalities: ['text'] }] }) : Response.json({ data: [] }));
  const profile = { provider: 'grok', displayName: 'Grok', piProvider: grokProvider(catalog),
    modelErrors: new Map(), configuredMaxTokens: new Map(), retryPolicy: grokRetryPolicy,
    streamIdleTimeoutMs: 3000, maxRequestImageBytes: 1_000_000, maxRequestImages: 10, imageOffloadCountQuantum: 1,
    requestImageMaxBytes: 128_000, requestImagePixelBudget: 32_768 };
  const adapter = new GrokAdapter(() => catalog, () => lifetime.signal, {
    profiles: () => new Map([['grok', profile]]), resolveApiKey: async () => 'synthetic-key',
    auth: { credentials: new InMemoryCredentialStore(), authContext: defaultProviderAuthContext() },
  });
  ctx.llm.registerAdapter(['grok'], adapter);
  const executions = [];
  ctx.tools.register(Tools.defineTool({
    name: toolName, description: 'Record a synthetic side effect', parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(_args, request) { executions.push(request.callId); return 'tool finished'; },
  }));
  const oldBypass = process.env.NO_PROXY;
  process.env.NO_PROXY = 'api.x.ai';
  t.after(() => { if (oldBypass === undefined) delete process.env.NO_PROXY; else process.env.NO_PROXY = oldBypass; });
  const requests = [];
  t.mock.method(globalThis, 'fetch', async request => {
    assert.equal(request.url, 'https://api.x.ai/v1/responses');
    assert.equal(request.headers.get('x-stainless-retry-count'), '0');
    requests.push(await request.json());
    switch (requests.length) {
      case 1: {
        const tool = toolCall('call-original');
        return sse(outputItem('added', { ...tool, status: 'in_progress', arguments: '' }), outputItem('done', tool), completed([tool]));
      }
      case 2: {
        const tool = toolCall('call-uncommitted');
        return sse(outputItem('added', { ...tool, status: 'in_progress', arguments: '' }), outputItem('done', tool),
          frame('response.failed', { response: { status: 'failed', error: { code: errorCode, message: 'synthetic-private-error' } } }));
      }
      case 3: {
        const content = { type: 'output_text', text: 'recovered', annotations: [] };
        const message = { type: 'message', id: 'msg-1', role: 'assistant', content: [content], status: 'completed' };
        return sse(outputItem('added', { ...message, status: 'in_progress', content: [] }),
          frame('response.content_part.added', { part: { ...content, text: '' } }),
          frame('response.output_text.delta', { delta: 'recovered' }), outputItem('done', message), completed([message]));
      }
      default: return new Response(null, { status: 401 });
    }
  });
  const agent = await ctx.agentLoop.create('grok-recovery', { provider: 'grok', model });
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Use the synthetic tool and reply.' }], source: { kind: 'user' } }));
  await agent.whenIdle();
  const events = agent.session.snapshotEvents();
  assert.equal(executions.length, 1, JSON.stringify(events.at(-1)?.data));
  assert.equal(events.filter(event => event.type === 'tool/result').length, 1);
  assert.doesNotMatch(JSON.stringify(events.filter(event => event.type !== 'assistant/attempt')), /synthetic-private-error|call-uncommitted/);
  assert.equal(events.at(-1).type, 'turn/end');
  return { requests, events, history: agent.session.deriveMessages(), end: events.at(-1).data.reason };
}

test('Grok recovers the failed model request without repeating the prior tool or executing a failed proposal', { timeout: 5000 }, async t => {
  const { requests, events, history, end } = await run(t, 'server_error');
  assert.equal(requests.length, 3);
  assert.deepEqual(requests[1], requests[2]);
  assert.ok(requests[2].input.some(part => part.type === 'function_call_output' && part.output === 'tool finished'));
  assert.deepEqual(events.filter(event => event.type === 'llm/retry').map(({ data }) => [data.turn, data.step, data.failure.code]), [[1, 2, 'SERVER']]);
  assert.deepEqual(end, { kind: 'completed' });
  assert.deepEqual(history.at(-1).content, [{ type: 'text', text: 'recovered' }]);
});

test('Grok leaves an unrecognized provider code non-retryable', { timeout: 5000 }, async t => {
  const { requests, events, end } = await run(t, 'future_error');
  assert.equal(requests.length, 2);
  assert.ok(!events.some(event => event.type === 'llm/retry'));
  assert.equal(end.kind, 'error');
  assert.equal(end.error.code, 'PI_AI_ERROR');
});
