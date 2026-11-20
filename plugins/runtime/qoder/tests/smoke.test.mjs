import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { Context } from '@deepseek-ai/cordis';
import { LlmRuntime } from '@deepseek-ai/dsh-llm';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import * as plugin from '../lib/index.js';
import { advertiseTools, buildPrompt } from '../lib/request.js';
import { readResponse } from '../lib/stream.js';

const request = {
  provider: 'qoder',
  model: 'lite',
  messages: [{ role: 'user', content: [{ type: 'text', text: '/literal\n你好' }] }],
};
const tool = {
  name: 'read_fixture',
  description: 'Read a synthetic fixture',
  parameters: { type: 'object', properties: { name: { type: 'string', enum: ['fixture'] } }, required: ['name'] },
};
const source = async function* (messages) { yield* messages; };
const collect = Array.fromAsync;
const event = (type, fields) => ({ type: 'stream_event', event: { type, ...fields } });
const assistant = content => ({ type: 'assistant', message: { content } });
const result = fields => ({ type: 'result', subtype: 'success', is_error: false, ...fields });
const liteModels = async () => [{ value: 'lite', displayName: 'Lite' }];
const call = { type: 'tool_use', id: 'call-1', name: 'mcp__dsh__tool_1', input: { name: 'fixture' } };

test('Cordis keeps unbound accounts out of the provider registry across reloads', async () => {
  const ctx = new Context();
  ctx.provide('credentials', { async resolve() { return undefined; } });
  const runtime = ctx.plugin(LlmRuntime);
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const handle = ctx.plugin(plugin);
      try {
        await setImmediate();
        assert.deepEqual(ctx.llm.listProviders().filter(p => p.id.startsWith('qoder')), []);
        assert.ok(ctx.get('dshQoderAccountUsage'));
      } finally {
        await handle.dispose();
      }
      assert.ok(!ctx.llm.listProviders().some(p => p.id === 'qoder'));
    }
  } finally {
    await runtime.dispose();
  }
});

test('serializes ordered DSH history and validates unsupported inputs', () => {
  const callBlock = { type: 'tool-call', id: 'call-1', name: tool.name, arguments: '{"name":"fixture"}' };
  const messages = [
    { role: 'system', content: [{ type: 'text', text: 'System prompt' }] },
    ...request.messages,
    { role: 'assistant', content: [callBlock, { type: 'reasoning', text: 'private thinking' }] },
    { role: 'tool', toolCallId: 'call-1', isError: true, content: [{ type: 'text', text: 'fixture failed' }] },
  ];
  const { input, systemPrompt } = buildPrompt({ ...request, messages, system: 'Be brief' });
  assert.match(systemPrompt, /^Be brief\n\nSystem prompt/);
  assert.equal(input.client_composed, true);
  const history = JSON.parse(input.message.content);
  assert.deepEqual(history.map(message => message.role), ['user', 'assistant', 'tool']);
  assert.deepEqual(history[0].content, request.messages[0].content);
  assert.deepEqual(history[1].content, [callBlock]);
  assert.equal(history[2].toolCallId, 'call-1');
  assert.equal(history[2].isError, true);
  assert.throws(() => buildPrompt({ ...request, stop: ['stop'] }), { code: 'UNSUPPORTED_OPTION' });
  assert.throws(() => buildPrompt({ ...request, messages: [{ role: 'user', content: [{ type: 'image' }] }] }),
    { code: 'UNSUPPORTED_CONTENT' });
});

test('MCP lists host JSON schemas and its call handler performs no tool action', async () => {
  const { mcpServers } = advertiseTools([tool]);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'qoder-test', version: '1.0.0' });
  const server = mcpServers.dsh.instance;
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const { tools } = await client.listTools();
    assert.deepEqual(tools, [{ name: 'tool_1', description: 'read_fixture: Read a synthetic fixture', inputSchema: tool.parameters }]);
    assert.equal((await client.callTool({ name: 'tool_1', arguments: { name: 'fixture' } })).isError, true);
  } finally {
    await client.close();
    await server.close();
  }
});

test('streams thinking and text without replaying complete assistant blocks', async () => {
  const messages = [
    event('content_block_delta', { index: 0, delta: { type: 'thinking_delta', thinking: '思考' } }),
    assistant([{ type: 'thinking', thinking: '思考' }]),
    event('content_block_stop', { index: 0 }),
    event('content_block_delta', { index: 1, delta: { type: 'text_delta', text: '你' } }),
    event('content_block_delta', { index: 1, delta: { type: 'text_delta', text: '好' } }),
    event('content_block_stop', { index: 1 }),
    assistant([{ type: 'text', text: '你好' }]),
    result({ result: '你好', usage: { input_tokens: 3, output_tokens: 4, cache_read_input_tokens: 5, cache_creation_input_tokens: 6 } }),
  ];
  const chunks = await collect(readResponse(source(messages), new Map(), new AbortController().signal));
  assert.deepEqual(chunks.filter(chunk => chunk.type === 'block-end').map(chunk => chunk.block), [
    { type: 'reasoning', text: '思考' }, { type: 'text', text: '你好' },
  ]);
  assert.deepEqual(chunks.at(-2).usage, { inputTokens: 3, outputTokens: 4, cacheReadTokens: 5, cacheWriteTokens: 6 });
  assert.equal(chunks.at(-1).reason.kind, 'stop');
});

test('hands declared multi-tool calls back to DSH only after a complete turn', async () => {
  const { toolNames } = advertiseTools([tool, { ...tool, name: 'other_fixture' }]);
  const read = messages => collect(readResponse(source(messages), toolNames, new AbortController().signal));
  const second = { ...call, id: 'call-2', name: 'mcp__dsh__tool_2' };
  const chunks = await read([assistant([call, second]), result({ subtype: 'error_max_turns', is_error: true })]);
  assert.deepEqual(chunks.filter(chunk => chunk.type === 'block-end').map(chunk => chunk.block.name), ['read_fixture', 'other_fixture']);
  assert.equal(chunks.at(-1).reason.kind, 'tool-calls');
  await assert.rejects(read([assistant([{ ...call, name: 'Bash' }]), result()]), { code: 'INVALID_RESPONSE' });
  await assert.rejects(read([assistant([call])]), { code: 'INVALID_RESPONSE' });
  const truncated = await read([assistant([call]), result({ stop_reason: 'max_tokens' })]);
  assert.deepEqual(truncated, [{ type: 'finish', reason: { kind: 'max-tokens' } }]);
});

test('cancellation, unloading and early iterator return close the SDK and remove the temporary directory', async () => {
  const binary = process.execPath;
  for (const action of ['cancel', 'unload', 'return']) {
    const controller = new AbortController();
    let closeCount = 0;
    let workdir;
    let entered;
    const ready = new Promise(resolve => { entered = resolve; });
    const adapter = new plugin.QoderAdapter({ cliPath: binary }, async (_path, input, options) => {
      workdir = options.cwd;
      assert.deepEqual(options.tools, []);
      assert.equal(options.maxTurns, 1);
      assert.equal(options.persistSession, false);
      assert.equal((await collect(input))[0].client_composed, true);
      const signal = options.abortController.signal;
      const events = (async function* () {
        entered();
        if (action === 'return') {
          yield event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'partial' } });
          return;
        }
        await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
      })();
      return { events, async close() { closeCount++; } };
    }, liteModels, async () => undefined);
    const iterator = adapter.stream({ ...request, signal: controller.signal });
    if (action === 'return') {
      assert.equal((await iterator.next()).value.type, 'block-start');
      await iterator.return();
    } else {
      const response = collect(iterator);
      await ready;
      if (action === 'cancel') controller.abort();
      else adapter.dispose();
      assert.equal((await response).at(-1).reason.kind, 'aborted');
    }
    assert.equal(closeCount, 1);
    await assert.rejects(access(workdir), { code: 'ENOENT' });
  }
});

test('does not expose upstream diagnostics after authentication and verification failures', async () => {
  const adapter = new plugin.QoderAdapter({ cliPath: process.execPath }, async () => ({
    events: source([result({ subtype: 'error_during_execution', is_error: true, error_code: 401, errors: ['synthetic credential'] })]),
    async close() {},
  }), liteModels, async () => undefined);
  const output = await collect(adapter.stream(request));
  assert.equal(output.at(-1).reason.failure.code, 'AUTH');
  assert.doesNotMatch(JSON.stringify(output), /synthetic credential/);
  const missing = await collect(new plugin.QoderAdapter({ cliPath: 'relative' }).stream(request));
  assert.equal(missing.at(-1).reason.failure.code, 'INVALID_REQUEST');
});

test('uses the selected model’s advertised efforts for the main Qoder call', async () => {
  const policies = [];
  const adapter = new plugin.QoderAdapter({ cliPath: process.execPath }, async (_path, _input, options) => {
    policies.push(options.resolveModel);
    return { events: source([result({ result: 'ready' })]), async close() {} };
  }, async () => [
    { value: 'lite', displayName: 'Lite', isReasoning: true },
    { value: 'pro', efforts: ['low', 'high', 'low'], defaultEffort: 'low' },
  ], async () => undefined);
  try {
    const [lite, pro] = await adapter.listModels('qoder');
    assert.equal(lite.reasoning, undefined);
    assert.deepEqual(pro.reasoning, { efforts: [{ id: 'low', name: 'low' }, { id: 'high', name: 'high' }], defaultEffort: 'low' });
    for (const model of ['lite', 'pro']) {
      assert.equal((await collect(adapter.stream({ ...request, model, reasoningEffort: 'high' }))).at(-1).reason.kind, 'stop');
    }
    assert.equal(policies[0], undefined);
    assert.deepEqual(policies[1]({ purpose: 'main' }), { model: 'pro', parameters: { reasoningEffort: 'high' } });
    assert.equal(policies[1]({ purpose: 'title' }), undefined);
    const invalid = await collect(adapter.stream({ ...request, model: 'pro', reasoningEffort: 'max' }));
    assert.equal(invalid.at(-1).reason.failure.code, 'UNSUPPORTED_REASONING_EFFORT');
    assert.equal(policies.length, 2);
  } finally { adapter.dispose(); }
});

test('named accounts use their actual live catalogs and cannot cross-charge', async () => {
  const accounts = [
    { id: 'personal', name: 'Personal', tokenEnv: 'TEST_QODER_PERSONAL' },
    { id: 'work', name: 'Work', tokenEnv: 'TEST_QODER_WORK', models: ['lite', 'work-specific'] },
  ];
  const credentials = new Map([['TEST_QODER_PERSONAL', 'synthetic-personal'], ['TEST_QODER_WORK', 'synthetic-work']]);
  const selected = [];
  const queried = [];
  const adapter = new plugin.QoderAdapter({ cliPath: process.execPath, accounts },
    async (_path, _input, _options, auth) => {
      selected.push(auth);
      return { events: source([result({ result: 'ready' })]), async close() {} };
    },
    async (_path, auth) => {
      queried.push(auth.accessToken);
      if (auth.accessToken === 'synthetic-personal') return [
        { value: 'personal-specific', displayName: 'Personal Model' },
        { value: 'disabled-model', displayName: 'Disabled', isEnabled: false },
      ];
      if (auth.accessToken === 'synthetic-work') return [
        { value: 'lite', displayName: 'Lite' }, { value: 'work-specific', displayName: 'Work Model' },
        { value: 'filtered', displayName: 'Filtered' },
      ];
      return [];
    },
    async ref => credentials.get(ref));
  try {
    assert.deepEqual(adapter.providers, ['qoder', 'qoder-account-personal', 'qoder-account-work']);
    assert.deepEqual((await adapter.listModels('qoder-account-personal')).map(model => model.id), ['personal-specific']);
    assert.deepEqual((await adapter.listModels('qoder-account-work')).map(model => model.id), ['lite', 'work-specific']);
    await assert.rejects(adapter.resolveModel('qoder-account-personal', 'lite'), { code: 'UNKNOWN_MODEL' });
    assert.equal((await collect(adapter.stream({ ...request, provider: 'qoder-account-work' }))).at(-1).reason.kind, 'stop');
    assert.deepEqual(selected, [{ type: 'accessToken', accessToken: 'synthetic-work' }]);
    assert.deepEqual(queried, ['synthetic-personal', 'synthetic-work']);

    credentials.set('TEST_QODER_WORK', 'replacement-token');
    assert.deepEqual(await adapter.listModels('qoder-account-work'), []);
    assert.equal(queried.at(-1), 'replacement-token');
    credentials.delete('TEST_QODER_WORK');
    assert.deepEqual(await adapter.listModels('qoder-account-work'), []);
    assert.equal((await collect(adapter.stream({ ...request, provider: 'qoder-account-work' }))).at(-1).reason.failure.code, 'MISSING_CREDENTIAL');
    const work = await adapter.accounts.statusOf('qoder-account-work');
    const personal = await adapter.accounts.statusOf('qoder-account-personal');
    assert.equal(work.state, 'unbound');
    assert.equal(personal.state, 'connected');
    assert.doesNotMatch(JSON.stringify([work, personal]), /synthetic-personal|replacement-token/);
  } finally {
    adapter.dispose();
  }
});

test('account remarks survive reload and preserve legacy and managed routes', async () => {
  const refs = new Map();
  const records = new Map();
  const credentials = {
    async listRecords() { return [...records].map(([key, value]) => ({ key, kind: value.kind })); },
    async readRecord(key) { return records.get(key); },
    async modifyRecord(key, mutate) {
      const next = await mutate(records.get(key));
      if (next) records.set(key, next);
      return records.get(key);
    },
    async deleteRecord(key) { records.delete(key); },
    async unset(ref) { refs.delete(ref); },
    async set(ref, token) { refs.set(ref, token); },
  };
  const adapter = () => new plugin.QoderAdapter({ cliPath: process.execPath }, undefined, liteModels,
    async ref => refs.get(ref), () => credentials);
  const first = adapter();
  await first.accounts.reload();
  assert.deepEqual(first.providers, ['qoder']);

  refs.set('QODER_PERSONAL_PAT', 'synthetic-legacy');
  assert.equal(await first.accounts.change({ kind: 'add', remark: '', token: 'synthetic-managed' }), true);
  await first.accounts.reload();
  const managed = first.providers.find(provider => provider.startsWith('qoder-account-a-'));
  const legacy = 'qoder-account-personal';
  assert.deepEqual(first.providers, ['qoder', legacy, managed]);
  assert.equal(first.providerInfo(legacy).name, 'Qoder · Account 01');
  await first.accounts.change({ kind: 'remark', provider: managed, remark: '工作' });
  await first.accounts.change({ kind: 'remark', provider: legacy, remark: '个人' });
  first.dispose();

  const reloaded = adapter();
  try {
    await reloaded.accounts.reload();
    assert.deepEqual(reloaded.providers, ['qoder', legacy, managed]);
    assert.equal(reloaded.providerInfo(managed).name, 'Qoder · 工作');
    assert.equal(reloaded.providerInfo(legacy).name, 'Qoder · 个人');
    assert.equal((await reloaded.accounts.auth(managed)).accessToken, 'synthetic-managed');
    assert.equal((await reloaded.accounts.auth(legacy)).accessToken, 'synthetic-legacy');
    assert.doesNotMatch(JSON.stringify(await reloaded.accounts.statusOf(managed)), /synthetic-managed/);
    await reloaded.accounts.change({ kind: 'unbind', provider: managed });
    await reloaded.accounts.reload();
    assert.deepEqual(reloaded.providers, ['qoder', legacy]);
    assert.equal(await reloaded.accounts.change({ kind: 'remark', provider: managed, remark: 'stale edit' }), false);
  } finally {
    reloaded.dispose();
  }
});
