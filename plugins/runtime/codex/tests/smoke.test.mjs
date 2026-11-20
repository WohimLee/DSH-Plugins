import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import { LlmRuntime, BlockAssembler, attributionHeaders } from '@deepseek-ai/dsh-llm';
import * as plugin from '../lib/index.js';
import { buildRequest } from '../lib/request.js';
import { macProxyForHost } from '../lib/proxy.js';
import { loadModels, loadCredential } from '../lib/local.js';
import { parseStream } from '../lib/stream.js';
const collect = async source => { const result = []; for await (const item of source) result.push(item); return result; };
const event = (type, fields = {}) => ({ type, ...fields });
function body(events, { split = false, cancelled = () => {} } = {}) {
  const bytes = new TextEncoder().encode(events.map(e => `data: ${JSON.stringify(e)}\r\n\r\n`).join(''));
  return new ReadableStream({ start(c) { if (split) for (const byte of bytes) c.enqueue(Uint8Array.of(byte)); else c.enqueue(bytes); c.close(); }, cancel: cancelled });
}
const request = { provider: 'codex', model: 'test-model', messages: [{ role: 'user', content: [{ type: 'text', text: '你好' }] }] };
const models = [{ id: 'test-model', contextWindow: 10000, efforts: ['low', 'high'] }];
async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), 'dsh-codex-test-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  await writeFile(join(home, 'auth.json'), JSON.stringify({ auth_mode: 'chatgpt', tokens: { access_token: 'synthetic-secret', account_id: 'synthetic-account' } }));
  return home;
}
test('credential and cache boundaries tolerate malformed files and only advertise eligible models', async t => {
  const home = await fixture(t);
  assert.equal((await loadCredential(home)).accessToken, 'synthetic-secret');
  for (const value of [null, {}, { tokens: { access_token: 12, account_id: 'x' } }, { auth_mode: 'apikey' }]) {
    await writeFile(join(home, 'auth.json'), JSON.stringify(value)); await assert.rejects(loadCredential(home), { code: 'AUTH' });
  }
  await writeFile(join(home, 'models_cache.json'), JSON.stringify({ models: [null, { slug: 'hidden', visibility: 'hide', supported_in_api: true },
    { slug: 'available', display_name: 'Available', visibility: 'list', supported_in_api: true, context_window: 20000, default_reasoning_level: 'high', supported_reasoning_levels: [null, { effort: 'high' }] }] }));
  assert.deepEqual(await loadModels(home), [{ id: 'available', name: 'Available', contextWindow: 20000, defaultEffort: 'high', efforts: ['high'] }]);
  assert.deepEqual(await loadModels(home, models), models);
});
test('manual macOS HTTPS proxy honors excluded hosts and automatic configurations', () => {
  const settings = 'HTTPSEnable : 1\nHTTPSProxy : 127.0.0.1\nHTTPSPort : 7890';
  assert.equal(macProxyForHost(settings, 'chatgpt.com'), 'http://127.0.0.1:7890');
  for (const excluded of ['chatgpt.com', '*.com']) {
    assert.equal(macProxyForHost(settings + '\nExceptionsList : <array> {\n  0 : ' + excluded + '\n}', 'chatgpt.com'), undefined);
  }
  assert.equal(macProxyForHost(settings + '\nProxyAutoConfigEnable : 1', 'chatgpt.com'), undefined);
  assert.equal(macProxyForHost(settings.replace('7890', '65536'), 'chatgpt.com'), undefined);
});
test('request preserves system prompt, tool calls, tool results and optional argument schemas', () => {
  const result = buildRequest({ ...request, system: 'one', reasoningEffort: 'high', messages: [
    { role: 'system', content: [{ type: 'text', text: 'two' }] },
    { role: 'assistant', content: [{ type: 'tool-call', id: 'call-1', name: 'read', arguments: '{"path":"x"}' }] },
    { role: 'tool', toolCallId: 'call-1', content: [{ type: 'text', text: 'file data' }] },
  ], tools: [{ name: 'read', parameters: { type: 'object', required: ['path'] } }] });
  assert.equal(result.instructions, 'one\n\ntwo'); assert.equal(result.store, false);
  assert.deepEqual(result.input, [{ type: 'function_call', call_id: 'call-1', name: 'read', arguments: '{"path":"x"}' }, { type: 'function_call_output', call_id: 'call-1', output: 'file data' }]);
  assert.deepEqual(result.tools[0].parameters.properties, { path: {} }); assert.equal(result.tools[0].strict, false);
  assert.throws(() => buildRequest({ ...request, tools: [{ name: 'bad', parameters: { oneOf: [] } }] }), { code: 'INVALID_REQUEST' });
  assert.throws(() => buildRequest({ ...request, messages: [{ role: 'user', content: [{ type: 'image' }] }] }), { code: 'UNSUPPORTED_CONTENT' });
});
test('SSE survives byte fragmentation, assembles Unicode/reasoning/tools and accounts uncached tokens', async () => {
  const chunks = await collect(parseStream(body([
    event('response.reasoning_summary_text.delta', { delta: '思考' }), event('response.output_text.delta', { delta: '你好🌍' }),
    event('response.output_item.done', { item: { type: 'function_call', id: 'item-1', call_id: 'call-1', name: 'read', arguments: '{}' } }),
    event('response.completed', { response: { usage: { input_tokens: 100, output_tokens: 20, input_tokens_details: { cached_tokens: 30 } } } }),
  ], { split: true })));
  const assembler = new BlockAssembler(); for (const chunk of chunks) assembler.push(chunk);
  assert.deepEqual(chunks.filter(c => c.type === 'block-end').map(c => c.block), [
    { type: 'reasoning', text: '思考' }, { type: 'text', text: '你好🌍' }, { type: 'tool-call', id: 'call-1', name: 'read', arguments: '{}' },
  ]);
  assert.deepEqual(chunks.find(c => c.type === 'usage').usage, { inputTokens: 70, outputTokens: 20, cacheReadTokens: 30, totalTokens: 120 });
  assert.equal(chunks.at(-1).reason.kind, 'tool-calls');
});
test('truncated, malformed, failed and incomplete streams have explicit outcomes', async () => {
  await assert.rejects(collect(parseStream(body([event('response.output_text.delta', { delta: 'partial' })]))), { code: 'TRANSPORT' });
  await assert.rejects(collect(parseStream(body([event('response.failed', { response: { error: { message: 'private echo' } } })]))), { code: 'UNKNOWN' });
  await assert.rejects(collect(parseStream(body([event('response.output_item.done', { item: { type: 'function_call' } })]))), { code: 'INVALID_RESPONSE' });
  const chunks = await collect(parseStream(body([event('response.incomplete', { response: { incomplete_details: { reason: 'max_output_tokens' } } })])));
  assert.equal(chunks.at(-1).reason.kind, 'max-tokens');
  const invalid = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('data: {broken}\n\n')); c.close(); } });
  await assert.rejects(collect(parseStream(invalid)), { code: 'INVALID_RESPONSE' });
});
test('adapter dispatch uses fixed HTTPS endpoint, attribution and host-readable terminal chunks', async t => {
  const home = await fixture(t), before = await readFile(join(home, 'auth.json'), 'utf8');
  let calls = 0;
  const adapter = new plugin.CodexAdapter({ codexHome: home, models }, async (url, init) => {
    calls++; assert.equal(url, plugin.RESPONSES_URL); assert.equal(init.redirect, 'error');
    assert.equal(init.headers.authorization, 'Bearer synthetic-secret');
    assert.equal(init.headers['user-agent'], attributionHeaders()['user-agent']);
    assert.equal(JSON.parse(init.body).instructions, '');
    return new Response(body([event('response.output_text.delta', { delta: 'answer' }), event('response.completed')]));
  });
  const chunks = await collect(adapter.stream(request)); assert.equal(chunks.at(-1).reason.kind, 'stop'); assert.equal(calls, 1);
  assert.equal(await readFile(join(home, 'auth.json'), 'utf8'), before);
  const info = await adapter.resolveModel('codex', 'test-model'); assert.equal(info.context.contextWindow, 10000); assert.equal(info.reasoning.efforts[1].id, 'high');
  await assert.rejects(adapter.resolveModel('codex', 'unknown'), { code: 'UNKNOWN_MODEL' });
});
test('models expose only declared default efforts and reject unsupported overrides before fetch', async t => {
  const codexHome = await fixture(t);
  const adapter = new plugin.CodexAdapter({ codexHome, models: [
    { id: 'variable', efforts: ['low', 'high'], defaultEffort: 'low' },
    { id: 'fixed' }, { id: 'invalid-default', efforts: ['low'], defaultEffort: 'high' },
  ] }, () => assert.fail('invalid request reached fetch'));
  const catalog = await adapter.listModels('codex');
  assert.equal(catalog[0].reasoning.defaultEffort, 'low');
  assert.equal(catalog[1].reasoning, undefined);
  assert.equal(catalog[2].reasoning.defaultEffort, undefined);
  for (const model of ['fixed', 'variable']) {
    const chunks = await collect(adapter.stream({ ...request, model, reasoningEffort: 'max' }));
    assert.equal(chunks.at(-1).reason.failure.code, 'UNSUPPORTED_OPTION');
  }
});
test('HTTP and network failures never expose credentials or response text', async t => {
  const home = await fixture(t);
  for (const [status, code] of [[401,'AUTH'],[403,'AUTH'],[429,'RATE_LIMIT'],[500,'SERVER'],[400,'HTTP_400']]) {
    const adapter = new plugin.CodexAdapter({ codexHome: home, models }, async () => new Response('synthetic-secret', { status }));
    const chunks = await collect(adapter.stream(request)); assert.equal(chunks.at(-1).reason.failure.code, code); assert.doesNotMatch(JSON.stringify(chunks), /synthetic-secret/);
  }
  const adapter = new plugin.CodexAdapter({ codexHome: home, models }, async () => { throw new Error('synthetic-secret'); });
  assert.doesNotMatch(JSON.stringify(await collect(adapter.stream(request))), /synthetic-secret/);
});
test('cancel and unload abort in-flight requests and block new dispatch', async t => {
  const home = await fixture(t);
  for (const unload of [false, true]) {
    let started; const ready = new Promise(resolve => { started = resolve; });
    const adapter = new plugin.CodexAdapter({ codexHome: home, models }, async (_url, { signal }) => {
      started(); return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    });
    const controller = new AbortController(), result = collect(adapter.stream({ ...request, signal: controller.signal }));
    await ready; if (unload) adapter.dispose(); else controller.abort();
    assert.equal((await result).at(-1).reason.kind, 'aborted');
    adapter.dispose(); assert.equal((await collect(adapter.stream(request))).at(-1).reason.kind, 'aborted');
  }
});
test('real Cordis/LLM registration supports model preparation, unload and reload', async t => {
  const codexHome = await fixture(t);
  const ctx = new Context();
  const runtime = ctx.plugin(LlmRuntime);
  const first = ctx.plugin(plugin, { models, codexHome });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(ctx.llm.listProviders().some(p => p.id === 'codex'));
  const prepared = await ctx.llm.prepareCall({ provider: 'codex', model: 'test-model' });
  assert.equal(prepared.context.contextWindow, 10000);
  await first.dispose(); assert.ok(!ctx.llm.listProviders().some(p => p.id === 'codex'));
  const second = ctx.plugin(plugin, { models, codexHome });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(ctx.llm.listProviders().filter(p => p.id === 'codex').length, 1);
  await second.dispose(); await runtime.dispose();
});

test('prepared calls retain catalog capabilities when the CLI cache changes', async t => {
  const home = await fixture(t);
  const cache = join(home, 'models_cache.json');
  await writeFile(cache, JSON.stringify({ models: [{ slug: 'test-model', visibility: 'list', supported_in_api: true, supported_reasoning_levels: [{ effort: 'high' }] }] }));
  const adapter = new plugin.CodexAdapter({ codexHome: home }, async () => new Response(body([event('response.completed')])));
  const prepared = await adapter.prepareCall('codex', 'test-model');
  await writeFile(cache, '{"models":[]}');
  assert.equal((await collect(prepared.stream({ ...request, reasoningEffort: 'high' }))).at(-1).reason.kind, 'stop');
  assert.equal((await collect(adapter.stream(request))).at(-1).reason.failure.code, 'UNKNOWN_MODEL');
});
test('stream cancellation and early consumer return release the response reader', async t => {
  const home = await fixture(t);
  let cancelled = false;
  const source = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('data: {"type":"response.output_text.delta","delta":"partial"}\n\n')); }, cancel() { cancelled = true; } });
  const iterator = parseStream(source);
  await iterator.next(); await iterator.next(); await iterator.return();
  assert.equal(cancelled, true); assert.equal(source.locked, false);
  let reading;
  const ready = new Promise(resolve => { reading = resolve; });
  const adapter = new plugin.CodexAdapter({ codexHome: home, models }, async (_url, { signal }) => {
    return new Response(new ReadableStream({ start(c) {
      c.enqueue(new TextEncoder().encode('data: {"type":"response.output_text.delta","delta":"partial"}\n\n'));
      signal.addEventListener('abort', () => c.error(signal.reason), { once: true }); reading();
    } }));
  });
  const controller = new AbortController();
  const result = collect(adapter.stream({ ...request, signal: controller.signal }));
  await ready; await new Promise(resolve => setTimeout(resolve, 0)); controller.abort();
  const chunks = await result;
  assert.equal(chunks.at(-1).reason.kind, 'aborted');
  assert.equal(chunks.filter(c => c.type === 'finish').length, 1);
});

test('omitted model configuration keeps cache discovery while explicit empty list disables it', () => {
  assert.equal(plugin.Config({}).models, undefined);
  assert.deepEqual(plugin.Config({ models: [] }).models, []);
});

test('rate limits use the Codex bucket and project windows without account details', async () => {
  const { projectRateLimits } = await import('../lib/usage.js');
  assert.deepEqual(projectRateLimits({
    rateLimits: { primary: { usedPercent: 100 } },
    rateLimitsByLimitId: { codex: {
      primary: { usedPercent: 18, windowDurationMins: 300 },
      secondary: { usedPercent: 38, windowDurationMins: 10080, resetsAt: 1810000000 },
      accountId: 'synthetic-account',
    } },
  }), { windows: [
    { remainingPercent: 82, minutes: 300 },
    { remainingPercent: 62, minutes: 10080, resetsAt: 1810000000 },
  ] });
  assert.equal(projectRateLimits({ rateLimits: { primary: { usedPercent: 'unknown' } } }), null);
});
