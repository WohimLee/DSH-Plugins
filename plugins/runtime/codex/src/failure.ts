import { LlmError, ProviderRequestId } from '@deepseek-ai/dsh-llm';
import type { BuiltinLlmFailureCode } from '@deepseek-ai/dsh-llm';
import { record } from './local.js';

// Only exact protocol codes are admitted. Messages, params and unknown codes may echo user data.
const codes = new Map<string, readonly [BuiltinLlmFailureCode, string]>([
  ['server_error', ['SERVER', '服务暂时出错。']],
  ['server_overloaded', ['SERVER', '模型服务暂时过载。']],
  ['server_is_overloaded', ['SERVER', '模型服务暂时过载。']],
  ['policy_capacity_unavailable', ['SERVER', '模型服务暂时无法提供容量。']],
  ['rate_limit_exceeded', ['RATE_LIMIT', '请求过于频繁。']],
  ['slow_down', ['RATE_LIMIT', '请求过于频繁。']],
  ['insufficient_quota', ['QUOTA', '账号额度不足。']],
  ['credit_balance_exhausted', ['QUOTA', '账号余额不足。']],
  ['organization_spend_limit_exceeded', ['QUOTA', '组织已达到支出上限。']],
  ['project_spend_limit_exceeded', ['QUOTA', '项目已达到支出上限。']],
  ['organization_usage_limit_exceeded', ['QUOTA', '组织已达到用量上限。']],
  ['usage_not_included', ['QUOTA', '当前套餐不包含此项用量。']],
  ['usage_limit_reached', ['QUOTA', '账号已达到用量上限。']],
  ['context_length_exceeded', ['CONTEXT_WINDOW_EXCEEDED', '请求超过模型上下文限制。']],
  ['invalid_api_key', ['AUTH', '登录或 API 密钥无效。']],
  ['invalid_prompt', ['INVALID_REQUEST', '请求内容无效。']],
  ['invalid_request_error', ['INVALID_REQUEST', '请求参数无效。']],
  ['content_policy_violation', ['CONTENT_REFUSED', '服务拒绝了请求内容。']],
]);

function classify(error: Record<string, unknown>) {
  // An explicit code is more specific than a category (e.g. a quota error on a 429).
  const key = error.code ?? error.type;
  return typeof key === 'string' ? codes.get(key) : undefined;
}

export type HeaderReader = { get(name: string): string | null };
function requestId(headers?: HeaderReader, credentials: readonly string[] = []) {
  const id = headers?.get('x-request-id');
  return id && /^(?:req_[0-9a-f]{8,64}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i.test(id)
    && !credentials.some(value => value && id.toLowerCase().includes(value.toLowerCase()))
    ? ProviderRequestId(id) : undefined;
}

function retryAfter(value: unknown): number | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  const delay = /^\d{1,10}$/.test(value) ? Number(value) * 1000
    : /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value) ? Date.parse(value) - Date.now()
    : NaN;
  return Number.isFinite(delay) && delay > 0 ? delay : undefined;
}

export function streamFailure(event: Record<string, unknown>, headers: HeaderReader | undefined,
  source: 'Codex' | 'OpenAI API', credentials: readonly string[]): LlmError {
  // The API emits a flat `error` event; Codex also emits a nested error envelope.
  const nested = record(event.error);
  const error = event.type === 'response.failed' ? record(record(event.response).error)
    : nested.code !== undefined || nested.type !== undefined ? nested : event;
  const classified = classify(error);
  const id = requestId(headers, credentials);
  const code = classified?.[0] ?? 'UNKNOWN';
  let delay = 0;
  if (code === 'RATE_LIMIT' || code === 'SERVER') {
    delay = retryAfter(headers?.get('retry-after')) ?? 0;
    for (const [name, value] of Object.entries(record(error.headers))) {
      if (name.toLowerCase() === 'retry-after') delay = Math.max(delay, retryAfter(value) ?? 0);
    }
  }
  return new LlmError(classified ? `${source} ${classified[1]}` : `${source} 服务返回响应失败。`, code,
    { ...(id && { requestId: id }), ...(delay && { providerRetryAfterMs: delay }) });
}

// HTTP error bodies are only read to distinguish structured request/quota failures, never emitted.
// A byte and time limit keep an error body from delaying the agent's recovery indefinitely.
async function readError(body: Response['body'] | import('node:stream/web').ReadableStream<Uint8Array> | null,
  signal: AbortSignal) {
  if (!body) return {};
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let size = 0, text = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stop: () => void = () => {};
  const deadline = new Promise<never>((_, reject) => {
    stop = () => reject(new Error());
    timer = setTimeout(stop, 1000);
    signal.addEventListener('abort', stop, { once: true });
  });
  try {
    signal.throwIfAborted();
    while (true) {
      const { value, done } = await Promise.race([reader.read(), deadline]);
      if (done) return record(record(JSON.parse(text + decoder.decode())).error);
      size += value.byteLength;
      if (size > 16_384) return {};
      text += decoder.decode(value, { stream: true });
    }
  } catch {
    return {};
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', stop);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function httpFailure(response: {
  status: number; headers: HeaderReader; body: Parameters<typeof readError>[0];
}, source: 'Codex' | 'OpenAI API', credentials: readonly string[], signal: AbortSignal): Promise<LlmError> {
  const { status, headers, body } = response;
  let classified: ReturnType<typeof classify>;
  if ((status === 400 || status === 429) && /^application\/json(?:\s*;|$)/i.test(headers.get('content-type') ?? '')) {
    const error = await readError(body, signal);
    const category = typeof error.type === 'string' ? codes.get(error.type) : undefined;
    classified = status === 429 && category?.[0] === 'QUOTA' ? category : classify(error);
  } else {
    void body?.cancel().catch(() => {});
  }
  // A gateway/status error is authoritative. A 400/429 may carry a more specific permanent rejection.
  const fallback: BuiltinLlmFailureCode = status === 401 || status === 403 ? 'AUTH'
    : status === 402 ? 'QUOTA' : status === 408 ? 'TIMEOUT' : status === 429 ? 'RATE_LIMIT'
      : [500, 502, 503, 504].includes(status) ? 'SERVER' : `HTTP_${status}`;
  const code = classified && classified[0] !== 'SERVER' && classified[0] !== 'RATE_LIMIT' ? classified[0] : fallback;
  const id = requestId(headers, credentials);
  const delay = code === 'RATE_LIMIT' || code === 'SERVER' ? retryAfter(headers.get('retry-after')) : undefined;
  const summary = code === 'AUTH' && source === 'Codex' ? 'Codex 登录失效或无访问权限，请运行 codex login。'
    : classified && code === classified[0] ? `${source} ${classified[1]}` : `${source} 请求失败（HTTP ${status}）。`;
  return new LlmError(summary, code, { status, ...(id && { requestId: id }), ...(delay && { providerRetryAfterMs: delay }) });
}
