import assert from 'node:assert/strict';
import { test } from 'node:test';
import { InMemoryCredentialStore, defaultProviderAuthContext } from '@earendil-works/pi-ai';
import { GrokAdapter } from '../lib/index.js';
import { grokProvider, readCatalog } from '../lib/catalog.js';
import { grokRetryPolicy } from '../lib/recovery.js';

const privateText = 'fixture-sensitive-context-credential';
const model = 'grok-recovery-fixture';
const routes = ['grok', 'grok-account-fixture'];
const options = { provider: routes[0], model, maxTokens: 128, messages: [{ role: 'user', content: [{ type: 'text', text: privateText }] }] };
const event = (type, fields = {}) => ({ type, ...fields });
const frame = (value, name = value.type) => `event: ${name}\ndata: ${JSON.stringify(value)}\n\n`;
const failed = code => event('response.failed', { response: { status: 'failed', error: { code, message: `network timeout 503 ${privateText}` } } });
const headers = { 'content-type': 'text/event-stream' };
const sse = (...events) => new Response(events.map(value => frame(value)).join(''), { headers });

async function fixture(t, fetchImpl, tune = value => value) {
  const controller = new AbortController();
  const catalog = await readCatalog('fixture', controller.signal, async url => url.endsWith('/language-models')
    ? Response.json({ models: [{ id: model, output_modalities: ['text'] }] }) : Response.json({ data: [] }));
  const profiles = new Map(routes.map(provider => [provider, {
    provider, displayName: 'Grok', piProvider: grokProvider(tune(catalog), provider),
    modelErrors: new Map(), configuredMaxTokens: new Map(), retryPolicy: grokRetryPolicy,
    streamIdleTimeoutMs: 3000, maxRequestImageBytes: 1_000_000, maxRequestImages: 10, imageOffloadCountQuantum: 1,
    requestImageMaxBytes: 128_000, requestImagePixelBudget: 32_768,
  }]));
  const adapter = new GrokAdapter(() => catalog, () => controller.signal, {
    profiles: () => profiles, resolveApiKey: async provider => `fixture-${provider}`,
    auth: { credentials: new InMemoryCredentialStore(), authContext: defaultProviderAuthContext() },
  });
  const previous = process.env.NO_PROXY;
  process.env.NO_PROXY = 'api.x.ai';
  t.after(() => { if (previous === undefined) delete process.env.NO_PROXY; else process.env.NO_PROXY = previous; });
  const fetch = t.mock.method(globalThis, 'fetch', request => {
    assert.equal(request.url, 'https://api.x.ai/v1/responses');
    assert.equal(request.headers.get('x-stainless-retry-count'), '0');
    return fetchImpl(request);
  });
  return { adapter, fetch };
}

function terminal(chunks, code, kind = 'error') {
  const result = chunks.filter(chunk => chunk.type === 'finish');
  assert.equal(result.length, 1);
  assert.equal(result[0].reason.kind, kind);
  const { failure } = result[0].reason;
  assert.equal(failure.code, code);
  assert.ok(!JSON.stringify(result).includes(privateText));
  assert.equal(grokRetryPolicy.retryableCodes.includes(code), ['RATE_LIMIT', 'SERVER', 'TRANSPORT', 'TIMEOUT', 'EMPTY_RESPONSE'].includes(code));
  return failure;
}

test('uses actual HTTP status and bounded host retry metadata instead of SDK prose', async t => {
  let response;
  const { adapter, fetch } = await fixture(t, () => response);
  const prepared = await adapter.prepareCall(routes[0], model);
  const cases = [
    [503, 'SERVER', '2', 2000, 'future_code'],
    [429, 'RATE_LIMIT', '30', 30000], // host must not shorten a provider delay above its cap
    [429, 'QUOTA', '2', undefined, 'insufficient_quota'],
    [408, 'TIMEOUT', '2junk', undefined],
    [401, 'AUTH', null, undefined, 'rate_limit_exceeded'],
    [403, 'AUTH', null, undefined, 'server_error'],
    [400, 'INVALID_REQUEST'],
    [409, 'HTTP_409'],
    [501, 'HTTP_501'],
  ];
  for (const [status, expected, retry, delay, code] of cases) {
    response = Response.json({ error: { code, message: `network timeout 503 ${privateText}` } }, {
      status, headers: { 'x-request-id': privateText, ...(retry ? { 'retry-after': retry } : {}) },
    });
    const failure = terminal(await Array.fromAsync(prepared.stream(options)), expected);
    assert.equal(failure.status, status);
    assert.equal(failure.providerRetryAfterMs, delay);
    assert.equal(failure.requestId, undefined);
    assert.equal(response.body.locked, false);
  }
  assert.equal(fetch.mock.callCount(), cases.length);
});

test('bounds stalled error-body inspection and releases its reader', async t => {
  let cancelled = false;
  const response = new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 503 });
  const { adapter, fetch } = await fixture(t, () => response);
  const chunks = await Array.fromAsync(adapter.stream(options));
  assert.equal(terminal(chunks, 'SERVER').status, 503);
  assert.equal(fetch.mock.callCount(), 1);
  assert.equal(response.body.locked, false);
  assert.ok(cancelled);
});

test('classifies structured SSE errors including SDK-intercepted error frames and rejects ambiguous ones', async t => {
  let response;
  const { adapter, fetch } = await fixture(t, () => response);
  const direct = event('error', { code: 'rate_limit_exceeded', message: privateText });
  const encoded = new TextEncoder().encode(`: heartbeat\r\nevent: error\r\ndata: ${JSON.stringify(direct)}\r\n\r\n`);
  response = new Response(new ReadableStream({ start(controller) {
    for (const octet of encoded) controller.enqueue(Uint8Array.of(octet));
    controller.close();
  } }), { headers });
  terminal(await Array.fromAsync(adapter.stream(options)), 'RATE_LIMIT');
  for (const [body, expected] of [
    [sse(failed('server_error')), 'SERVER'],
    [sse(failed('invalid_prompt')), 'INVALID_REQUEST'],
    [sse(failed('future_code')), 'PI_AI_ERROR'],
    [sse(event('error', { error: { code: 'insufficient_quota', message: privateText } })), 'QUOTA'],
    [sse(event('error', { code: 'future_code', message: 'OpenAI Responses stream ended before a terminal response event' })), 'PI_AI_ERROR'],
    [sse(event('response.incomplete', { response: { status: 'incomplete', incomplete_details: { reason: 'content_filter' } } })), 'CONTENT_REFUSED'],
    [sse(event('response.created', { response: { id: 'fixture' } })), 'TRANSPORT'],
    [new Response('event: error\ndata: not-json\n\n', { headers }), 'PI_AI_ERROR'],
  ]) {
    response = body;
    terminal(await Array.fromAsync(adapter.stream(options)), expected);
    assert.equal(response.body.locked, false);
  }
  assert.equal(fetch.mock.callCount(), 9);
});

test('isolates concurrent account attempts and only retries known network failures', async t => {
  let interrupt;
  const pending = new Promise(resolve => { interrupt = resolve; });
  const { adapter, fetch } = await fixture(t, async request => {
    if (request.headers.get('authorization') === `Bearer fixture-${routes[0]}`) {
      await pending;
      throw new TypeError(privateText, { cause: Object.assign(new Error(privateText), { code: 'ECONNRESET' }) });
    }
    return sse(failed('invalid_prompt'));
  });
  const direct = Array.fromAsync(adapter.stream(options));
  const prepared = await adapter.prepareCall(routes[1], model);
  terminal(await Array.fromAsync(prepared.stream({ ...options, provider: routes[1] })), 'INVALID_REQUEST');
  interrupt();
  terminal(await direct, 'TRANSPORT');
  assert.equal(fetch.mock.callCount(), 2);
});

test('keeps cancellation non-retryable and discards thrown transport details', async t => {
  let dispatched;
  const ready = new Promise(resolve => { dispatched = resolve; });
  let calls = 0;
  const { adapter, fetch } = await fixture(t, request => {
    if (++calls === 1) throw Object.assign(new Error(`network timeout ${privateText}`), { code: 'CERT_HAS_EXPIRED' });
    dispatched();
    return new Promise((_, reject) => request.signal.addEventListener('abort', () => reject(request.signal.reason), { once: true }));
  });
  terminal(await Array.fromAsync(adapter.stream(options)), 'PI_AI_ERROR');
  const abort = new AbortController();
  const streaming = Array.fromAsync(adapter.stream({ ...options, signal: abort.signal }));
  await ready;
  abort.abort(new Error(privateText));
  terminal(await streaming, 'ABORTED', 'aborted');
  assert.equal(fetch.mock.callCount(), 2);
});

test('does not dispatch xAI server-side tools even if payload options add one', async t => {
  const { adapter, fetch } = await fixture(t, () => assert.fail('unexpected request'), catalog => catalog.map(entry => ({
    ...entry, samplingParams: { tools: [{ type: 'web_search' }] },
  })));
  terminal(await Array.fromAsync(adapter.stream(options)), 'UNSUPPORTED_OPTION');
  assert.equal(fetch.mock.callCount(), 0);
});
