import assert from 'node:assert/strict';
import dns from 'node:dns';
import test from 'node:test';
import { LlmError } from '@deepseek-ai/dsh-llm';
import { ProxyAgent, errors as undiciErrors, fetch as proxyFetch } from 'undici';
import { CODEX_CONNECTION_FAILED, codexConnectionFailure } from '../lib/network-failure.js';

const privateDetail = 'synthetic-hostname-and-credential';
function systemError(code, syscall) {
  return Object.assign(new Error(privateDetail), { code, ...(syscall === undefined ? {} : { syscall }) });
}
function fetchError(cause) {
  return new TypeError('fetch failed', { cause });
}
function assertConnectionFailure(error) {
  const failure = codexConnectionFailure(error);
  assert.ok(failure instanceof LlmError);
  assert.equal(failure.code, 'CODEX_CONNECTION_FAILED');
  assert.equal(CODEX_CONNECTION_FAILED, failure.code);
  assert.deepEqual(failure.failure, { code: CODEX_CONNECTION_FAILED, message: '无法建立 Codex 连接，正在等待网络。' });
  assert.equal(failure.cause, undefined);
  assert.doesNotMatch(failure.stack, new RegExp(privateDetail));
}

test('recognizes temporary Node connect and DNS codes through fetch causes', () => {
  for (const code of ['ENETUNREACH', 'EHOSTUNREACH', 'ENETDOWN']) {
    assertConnectionFailure(systemError(code, 'connect'));
    assertConnectionFailure(fetchError(systemError(code, 'connect')));
  }
  assertConnectionFailure(fetchError(new Error('transport wrapper', { cause: systemError('EAI_AGAIN', 'getaddrinfo') })));
});

test('requires all members of a Node-style multi-address aggregate to identify a connection failure', () => {
  const unreachable = systemError('ENETUNREACH', 'connect');
  const host = systemError('EHOSTUNREACH', 'connect');
  assertConnectionFailure(fetchError(Object.assign(new AggregateError([unreachable, host]), { code: unreachable.code })));
  assertConnectionFailure(fetchError(new AggregateError([host, unreachable])));
  for (const other of [systemError('ECONNREFUSED', 'connect'), systemError('ETIMEDOUT', 'connect'), new Error('unknown')]) {
    const aggregate = Object.assign(new AggregateError([unreachable, other]), { code: unreachable.code });
    assert.equal(codexConnectionFailure(fetchError(aggregate)), undefined);
  }
  assert.equal(codexConnectionFailure(new AggregateError([])), undefined);
});

test('does not treat timeouts, refused/reset connections, ambiguous DNS, TLS or HTTP as definite network unavailability', () => {
  const unavailable = systemError('ENETUNREACH', 'connect');
  const timeout = new undiciErrors.ConnectTimeoutError();
  timeout.cause = new AggregateError([unavailable, systemError('ETIMEDOUT', 'connect')]);
  const cancelled = Object.assign(new Error('request cancelled', { cause: unavailable }), { code: 'ABORT_ERR' });
  const tls = Object.assign(systemError('ERR_TLS_CERT_ALTNAME_INVALID'), { cause: unavailable });
  const http = Object.assign(new Error('HTTP rejection', { cause: unavailable }), { statusCode: 407 });
  const harnessHttp = LlmError.fromFailure({ code: 'HTTP_503', message: 'unavailable', status: 503 }, { cause: unavailable });
  for (const error of [timeout, cancelled, tls, http, harnessHttp,
    systemError('ETIMEDOUT', 'connect'), systemError('ECONNREFUSED', 'connect'), systemError('ECONNRESET', 'read'),
    systemError('ENOTFOUND', 'getaddrinfo'), systemError('UND_ERR_HEADERS_TIMEOUT'), systemError('UND_ERR_BODY_TIMEOUT'),
    systemError('ENETUNREACH', 'read'), systemError('EAI_AGAIN', 'read'),
    new Error('connect ENETDOWN / EAI_AGAIN'), { code: 'ENETUNREACH' }, null]) {
    assert.equal(codexConnectionFailure(error), undefined);
    assert.equal(codexConnectionFailure(fetchError(error)), undefined);
  }
});

test('does not invoke accessors or let malformed cause graphs hide the original failure', () => {
  const poisoned = new Error('plain error');
  let accessorReads = 0;
  Object.defineProperty(poisoned, 'code', { get: () => { accessorReads++; return 'ENETDOWN'; } });
  assert.equal(codexConnectionFailure(fetchError(poisoned)), undefined);
  assert.equal(accessorReads, 0);
  const cycle = new Error('cycle');
  cycle.cause = cycle;
  assert.equal(codexConnectionFailure(cycle), undefined);
  const { proxy, revoke } = Proxy.revocable(new Error(), {});
  revoke();
  assert.equal(codexConnectionFailure(proxy), undefined);
});

test('preserves the custom code through the host LlmError serialization boundary', () => {
  const error = codexConnectionFailure(systemError('EAI_AGAIN', 'getaddrinfo'));
  assert.ok(error);
  const restored = LlmError.fromFailure(JSON.parse(JSON.stringify(error.failure)));
  assert.equal(restored.code, CODEX_CONNECTION_FAILED);
  assert.deepEqual(restored.failure, error.failure);
});

test('recognizes actual Node fetch and Undici ProxyAgent DNS failure wrappers without network traffic', async t => {
  let lookups = 0;
  const lookup = (_hostname, _options, callback) => {
    lookups++;
    queueMicrotask(() => callback(systemError('EAI_AGAIN', 'getaddrinfo')));
  };
  // Desktop Node's built-in undici uses a different dispatcher protocol than the bundled npm version.
  // Inject its lookup, not a foreign dispatcher, to exercise the exact native fetch path.
  t.mock.method(dns, 'lookup', lookup);
  const proxy = new ProxyAgent({ uri: 'http://proxy.codex-test.invalid:8080', proxyTls: { lookup } });
  t.after(() => proxy.destroy());
  const url = 'https://model.codex-test.invalid/';
  const rejectsWithConnectionFailure = error => {
    assert.ok(error instanceof TypeError);
    assert.equal(error.cause?.code, 'EAI_AGAIN');
    assertConnectionFailure(error);
    return true;
  };
  await assert.rejects(fetch(url), rejectsWithConnectionFailure);
  await assert.rejects(proxyFetch(url, { dispatcher: proxy }), rejectsWithConnectionFailure);
  assert.equal(lookups, 2);
});
