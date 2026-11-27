import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import { LlmRuntime, BlockAssembler, attributionHeaders } from '@deepseek-ai/dsh-llm';
import * as plugin from '../lib/index.js';
import { CodexApiAdapter } from '../lib/api.js';
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
test('request preserves system prompt, tool calls, tool results and optional argument schemas', async () => {
  const result = await buildRequest({ ...request, system: 'one', reasoningEffort: 'high', messages: [
    { role: 'system', content: [{ type: 'text', text: 'two' }] },
    { role: 'assistant', content: [{ type: 'tool-call', id: 'call-1', name: 'read', arguments: '{"path":"x"}' }] },
    { role: 'tool', toolCallId: 'call-1', content: [{ type: 'text', text: 'file data' }] },
  ], tools: [{ name: 'read', parameters: { type: 'object', required: ['path'] } }] });
  assert.equal(result.instructions, 'one\n\ntwo'); assert.equal(result.store, false);
  assert.deepEqual(result.input, [{ type: 'function_call', call_id: 'call-1', name: 'read', arguments: '{"path":"x"}' }, { type: 'function_call_output', call_id: 'call-1', output: 'file data' }]);
  assert.deepEqual(result.tools[0].parameters.properties, { path: {} }); assert.equal(result.tools[0].strict, false);
  await assert.rejects(() => buildRequest({ ...request, tools: [{ name: 'bad', parameters: { oneOf: [] } }] }), { code: 'INVALID_REQUEST' });
  await assert.rejects(() => buildRequest({ ...request, messages: [{ role: 'user', content: [{ type: 'image' }] }] }), { code: 'UNSUPPORTED_CONTENT' });
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
test('Responses failure frames classify only allowlisted codes and preserve safe retry metadata', async () => {
  const headers = new Headers({ 'x-request-id': 'req_0123456789abcdef', 'retry-after': '2' });
  for (const [type, providerCode, expected, delay] of [
    ['response.failed', 'server_error', 'SERVER', 2000], ['error', 'server_overloaded', 'SERVER', 2000],
    ['error', 'rate_limit_exceeded', 'RATE_LIMIT', 2000], ['error', 'usage_limit_reached', 'QUOTA', undefined],
    ['response.failed', 'context_length_exceeded', 'CONTEXT_WINDOW_EXCEEDED', undefined],
    ['response.failed', 'private-code', 'UNKNOWN', undefined],
  ]) {
    const error = { code: providerCode, type: 'server_error', message: 'private echo', param: 'private parameter' };
    const payload = type === 'response.failed' ? event(type, { response: { error } }) : { ...error, type };
    await assert.rejects(collect(parseStream(body([payload]), headers)), actual => {
      assert.equal(actual.failure.code, expected);
      assert.equal(actual.failure.requestId, 'req_0123456789abcdef');
      assert.equal(actual.failure.providerRetryAfterMs, delay);
      assert.doesNotMatch(JSON.stringify(actual.failure), /private/);
      return true;
    });
  }
  await assert.rejects(collect(parseStream(body([event('error', {
    error: { code: 'server_is_overloaded', message: 'private echo', headers: { 'Retry-After': '3', 'retry-after': '7' } },
  })]), headers, 'Codex', ['req_0123456789abcdef'])), error => {
    assert.equal(error.code, 'SERVER');
    assert.equal(error.failure.providerRetryAfterMs, 7000);
    assert.equal(error.failure.requestId, undefined);
    return true;
  });
});

test('both connection paths distinguish exhausted quota from a retryable 429', async t => {
  const codexHome = await fixture(t);
  const provider = 'codex-api-account-0123456789abcdef01234567';
  for (const [status, upstream, code, requestId, timing, type] of [
    ...['insufficient_quota', 'credit_balance_exhausted', 'organization_spend_limit_exceeded', 'project_spend_limit_exceeded']
      .map(upstream => [429, upstream, 'QUOTA', 'req_0123456789abcdef', undefined]),
    [429, 'rate_limit_exceeded', 'RATE_LIMIT', undefined, 2000],
    [408, undefined, 'TIMEOUT', 'req_0123456789abcdef', undefined],
    [501, undefined, 'HTTP_501', undefined, undefined],
    [429, 'private provider detail', 'QUOTA', undefined, undefined, 'usage_not_included'],
  ]) {
    const send = async () => Response.json({ error: { code: upstream, type, message: 'private echo' } }, {
      status, headers: { 'retry-after': '2', 'x-request-id': requestId ?? 'private echo' },
    });
    const routes = [
      [new plugin.CodexAdapter({ codexHome, models }, send), request],
      [new CodexApiAdapter({ provider, key: 'synthetic-key', label: 'test', models: ['gpt-5.3-codex'] },
        () => undefined, send), { ...request, provider, model: 'gpt-5.3-codex' }],
    ];
    for (const [adapter, input] of routes) {
      const { failure } = (await collect(adapter.stream(input))).at(-1).reason;
      assert.equal(failure.code, code);
      assert.equal(failure.requestId, requestId);
      assert.equal(failure.providerRetryAfterMs, timing);
      assert.doesNotMatch(JSON.stringify(failure), /private|synthetic-key/);
    }
  }
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
test('cancellation releases a stalled HTTP error body without waiting for diagnostics', async t => {
  const codexHome = await fixture(t);
  const signal = new AbortController();
  let notify, cancelled = 0;
  const pulled = new Promise(resolve => { notify = resolve; });
  const stalled = new ReadableStream({ pull() { notify(); }, cancel() { cancelled++; } }, { highWaterMark: 0 });
  const adapter = new plugin.CodexAdapter({ codexHome, models }, async () => new Response(stalled, {
    status: 429, headers: { 'content-type': 'application/json' },
  }));
  const result = collect(adapter.stream({ ...request, signal: signal.signal }));
  await pulled;
  signal.abort();
  assert.equal((await result).at(-1).reason.kind, 'aborted');
  assert.equal(stalled.locked, false);
  assert.equal(cancelled, 1);
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

test('desktop connections keep the original route, persist distinct local accounts and reject a changed login', async t => {
  const defaultHome = await fixture(t);
  const secondaryHome = await fixture(t);
  const thirdHome = await fixture(t);
  const duplicateHome = await fixture(t);
  const signedOutHome = await fixture(t);
  const executable = join(defaultHome, process.platform === 'win32' ? 'codex.exe' : 'codex');
  const auth = (home, account) => writeFile(join(home, 'auth.json'), JSON.stringify({
    auth_mode: 'chatgpt', tokens: { access_token: 'sensitive-synthetic-token', account_id: account },
  }));
  const cache = (home, model) => writeFile(join(home, 'models_cache.json'), JSON.stringify({
    models: [{ slug: model, visibility: 'list', supported_in_api: true }],
  }));
  await Promise.all([
    auth(secondaryHome, 'synthetic-secondary'),
    auth(duplicateHome, 'synthetic-secondary'),
    auth(thirdHome, 'synthetic-third'),
    rm(join(signedOutHome, 'auth.json')),
    cache(defaultHome, 'default-model'),
    cache(secondaryHome, 'secondary-model'),
    cache(thirdHome, 'third-model'),
    writeFile(executable, '', { mode: 0o755 }),
  ]);
  const alias = join(defaultHome, 'alternate-home');
  await symlink(secondaryHome, alias, 'junction');

  const ctx = new Context();
  const runtime = ctx.plugin(LlmRuntime);
  let saved;
  ctx.provide('credentials', {
    readRecord: async () => saved,
    modifyRecord: async (key, change) => {
      assert.equal(key, 'dsh-codex/desktop-accounts');
      const next = await change(saved);
      if (next) saved = structuredClone(next);
    },
  });
  const first = ctx.plugin(plugin, { codexHome: defaultHome, codexPath: executable });
  await new Promise(resolve => setTimeout(resolve, 20));
  const service = ctx.get('dshCodexAccountUsage');
  assert.deepEqual(await service.desktopAccounts(), {
    installed: true,
    canManage: true,
    accounts: [{ provider: 'codex', label: null, signedIn: true, modelCount: 1, removable: false }],
  });
  const add = (home, label) => service.changeDesktopAccount({ kind: 'add', home, label });
  assert.equal(await add('relative-home', 'Invalid'), 'invalidHome');
  assert.equal(await add(signedOutHome, 'Not logged in'), 'signedOut');
  assert.equal(await add(defaultHome, 'Default'), 'duplicate');
  assert.equal(await add(secondaryHome, 'Work'), 'ok');
  assert.equal(await add(alias, 'Alias'), 'duplicate');
  assert.equal(await add(duplicateHome, 'Duplicate'), 'duplicate');
  assert.equal(await add(thirdHome, 'Personal'), 'ok');
  assert.equal(await service.changeDesktopAccount({ kind: 'remove', provider: 'codex' }), 'notFound');
  const { accounts } = await service.desktopAccounts();
  const [, work, personal] = accounts;
  assert.equal(work.label, 'Work');
  assert.equal(work.modelCount, 1);
  assert.equal(personal.label, 'Personal');
  assert.notEqual(work.provider, personal.provider);
  assert.deepEqual(ctx.llm.listProviders().map(p => p.id).sort(), ['codex', work.provider, personal.provider].sort());
  await ctx.llm.prepareCall({ provider: work.provider, model: 'secondary-model' });
  await assert.rejects(ctx.llm.prepareCall({ provider: work.provider, model: 'third-model' }), { code: 'UNKNOWN_MODEL' });
  assert.doesNotMatch(JSON.stringify(saved), /sensitive-synthetic-token|synthetic-secondary|synthetic-third/);

  await first.dispose();
  assert.equal(ctx.llm.listProviders().length, 0);
  const second = ctx.plugin(plugin, { codexHome: defaultHome, codexPath: join(defaultHome, 'missing') });
  await new Promise(resolve => setTimeout(resolve, 20));
  const restored = ctx.get('dshCodexAccountUsage');
  assert.deepEqual(await restored.desktopAccounts(), { installed: false, canManage: true, accounts });
  await auth(secondaryHome, 'different-login');
  const changed = (await restored.desktopAccounts()).accounts.find(account => account.provider === work.provider);
  assert.equal(changed.signedIn, false);
  assert.equal(changed.modelCount, 0);
  await assert.rejects(ctx.llm.prepareCall({ provider: work.provider, model: 'secondary-model' }), { code: 'AUTH' });
  assert.equal(await restored.changeDesktopAccount({ kind: 'remove', provider: work.provider }), 'ok');
  assert.ok(!ctx.llm.listProviders().some(provider => provider.id === work.provider));
  assert.ok(ctx.llm.listProviders().some(provider => provider.id === personal.provider));
  assert.match(await readFile(join(secondaryHome, 'auth.json'), 'utf8'), /different-login/);
  await second.dispose();
  await runtime.dispose();
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

test('an older CLI cannot remove models from the newer catalog, including after restart', async t => {
  const home = await fixture(t);
  const path = join(home, 'models_cache.json');
  const model = (slug, visibility = 'list') => ({ slug, visibility, supported_in_api: true,
    input_modalities: ['text', 'image'], supported_reasoning_levels: [{ effort: 'high' }], base_instructions: 'not catalog metadata' });
  const write = (version, minute, models) => writeFile(path, JSON.stringify({
    client_version: version, fetched_at: `2026-11-20T07:${minute}:00Z`, models,
  }));
  const fallback = model('older-model');
  const target = model(request.model);
  const snapshotRoot = join(home, 'dsh-cache');
  const makeAdapter = (config = {}) => new plugin.CodexAdapter({ codexHome: home, ...config },
    async (_url, init) => {
      assert.equal(JSON.parse(init.body).reasoning.effort, 'high');
      return new Response(body([event('response.completed')]));
    }, () => undefined, snapshotRoot);
  const adapter = makeAdapter();
  await write('0.169.0', '01', [target, fallback]);
  assert.deepEqual((await adapter.listModels('codex')).map(model => model.id), [target.slug, fallback.slug]);
  await write('0.164.0', '02', [fallback]);
  assert.deepEqual((await adapter.listModels('codex')).map(model => model.id), [target.slug, fallback.slug]);
  assert.equal((await collect(makeAdapter().stream({ ...request, reasoningEffort: 'high' }))).at(-1).reason.kind, 'stop');
  assert.deepEqual(await makeAdapter({ models: [] }).listModels('codex'), []);

  await write('0.169.0', '03', [model(target.slug, 'hide'), fallback]);
  await assert.rejects(adapter.prepareCall('codex', target.slug), { code: 'UNKNOWN_MODEL' });
  await write('0.164.0', '04', [target, fallback]);
  await assert.rejects(makeAdapter().prepareCall('codex', target.slug), { code: 'UNKNOWN_MODEL' });
  await writeFile(join(home, 'auth.json'), JSON.stringify({ tokens: { access_token: 'another-token', account_id: 'other-account' } }));
  assert.deepEqual((await adapter.listModels('codex')).map(model => model.id), [target.slug, fallback.slug]);
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

test('image declarations survive discovery, native attachment conversion and capability withdrawal', async t => {
  const codexHome = await fixture(t);
  const cache = join(codexHome, 'models_cache.json');
  const model = { slug: 'test-model', description: 'Vision fixture', visibility: 'list', supported_in_api: true,
    context_window: 1000, max_context_window: 2000, effective_context_window_percent: 95,
    supported_reasoning_levels: [{ effort: 'high', description: 'Deeper reasoning' }], default_reasoning_level: 'high' };
  async function modalities(values) {
    await writeFile(cache, JSON.stringify({ models: [{ ...model, input_modalities: values }] }));
  }
  await modalities(['text', 'image', 'audio']);
  const ref = { attachmentId: 'sha256:' + 'c'.repeat(64), mediaType: 'image/png', width: 3, height: 4, bytes: 3 };
  const data = new Uint8Array([255, 0, 34]);
  let reads = 0, wire;
  const attachments = { async readImageRequest(actual, target, signal) {
    assert.deepEqual(actual, ref); assert.deepEqual(target, { width: 3, height: 4, maxBytes: 3 });
    assert.ok(signal instanceof AbortSignal); reads++;
    return { ...ref, data };
  } };
  const adapter = new plugin.CodexAdapter({ codexHome }, async (_url, init) => {
    wire = JSON.parse(init.body);
    return new Response(body([event('response.completed')]));
  }, () => attachments);
  const [info] = await adapter.listModels('codex');
  assert.deepEqual(info.inputModalities, ['text', 'image']);
  assert.equal(info.badge, undefined);
  assert.match(info.description, /audio/);
  assert.match(info.description, /2000/); assert.match(info.description, /95%/);
  assert.equal(info.reasoning.efforts[0].description, 'Deeper reasoning');
  const prepared = await adapter.prepareCall('codex', model.slug);
  const image = { type: 'image', attachment: ref };
  const options = { ...request, reasoningEffort: 'high', messages: [
    { role: 'user', content: [{ type: 'text', text: 'before' }, image, { type: 'text', text: 'after' }] },
    { role: 'tool', toolCallId: 'screenshot', content: [image] },
    { role: 'user', content: [{ ...image, offloaded: true }] },
  ] };
  await modalities(['text']);
  assert.deepEqual((await adapter.listModels('codex'))[0].inputModalities, ['text']);
  assert.equal((await collect(prepared.stream(options))).at(-1).reason.kind, 'stop');
  assert.equal(reads, 1);
  assert.deepEqual(wire.reasoning, { effort: 'high' });
  const parts = wire.input[0].content;
  assert.equal(parts[0].text, 'before'); assert.equal(parts[3].text, 'after');
  assert.deepEqual(parts[2], { type: 'input_image', image_url: 'data:image/png;base64,/wAi' });
  assert.deepEqual(wire.input[1].output[1], parts[2]);
  assert.match(wire.input[2].content[0].text, /image omitted/);
  assert.equal((await collect(adapter.stream(options))).at(-1).reason.failure.code, 'UNSUPPORTED_CONTENT');
  assert.equal(reads, 1);
  await modalities(['audio']);
  assert.equal((await adapter.listModels('codex')).length, 0);
  await modalities(undefined);
  assert.match((await adapter.listModels('codex'))[0].description, /未披露/);
  await modalities(['text','image']);
  const noStore = new plugin.CodexAdapter({ codexHome });
  assert.match((await noStore.listModels('codex'))[0].description, /附件服务不可用/);
  assert.deepEqual(await loadModels(codexHome, []), []);
  const inherited = await loadModels(codexHome, plugin.Config({ models: [{ id: model.slug }] }).models);
  assert.deepEqual(inherited[0].efforts, ['high']);
  assert.deepEqual(inherited[0].inputModalities, ['text','image']);
  const override = await loadModels(codexHome, [{ id: model.slug, inputModalities: ['text'] }]);
  assert.equal(override[0].modalitySource, 'config');
  assert.deepEqual(override[0].inputModalities, ['text']);
});
