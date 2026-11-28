import { AsyncLocalStorage } from 'node:async_hooks';
import { clearTimeout, setTimeout } from 'node:timers';
import { isContextWindowExceededError, isQuotaExceededError, LlmError, resolveRetryPolicy } from '@deepseek-ai/dsh-llm';
import type { BuiltinLlmFailureCode, LlmFailure } from '@deepseek-ai/dsh-llm';
import { fetchGrok } from './transport.js';

export const grokRetryPolicy = resolveRetryPolicy({
  mode: 'normal', retryableCodes: ['EMPTY_RESPONSE', 'RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT'],
}, 'grok.retryPolicy');

type Attempt = { beforeDispatch: () => void; guardFailure?: LlmFailure; failure?: LlmFailure; eof?: boolean };
export const grokAttempt = new AsyncLocalStorage<Attempt>();

export function grokFailure(code: string, metadata?: Omit<LlmFailure, 'code' | 'message'>): LlmFailure {
  return { code, message: code === 'ABORTED' ? 'Grok request was cancelled.' : `Grok request failed (${code}).`, ...metadata };
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' ? value as Record<string, unknown> : undefined;

function structuredCode(error: Record<string, unknown> | undefined): BuiltinLlmFailureCode | undefined {
  switch (error?.code ?? error?.type) {
    case 'server_error': return 'SERVER';
    case 'rate_limit_exceeded': return 'RATE_LIMIT';
    case 'insufficient_quota':
    case 'insufficient_credits':
    case 'insufficient_balance': return 'QUOTA';
    case 'invalid_api_key':
    case 'permission_denied': return 'AUTH';
    case 'context_length_exceeded': return 'CONTEXT_WINDOW_EXCEEDED';
    case 'content_filter': return 'CONTENT_REFUSED';
    case 'invalid_request_error':
    case 'invalid_prompt': return 'INVALID_REQUEST';
    default: return undefined;
  }
}

function retryAfter(headers: Headers): number | undefined {
  const value = headers.get('retry-after');
  if (!value) return;
  const delay = /^\d+$/.test(value) ? Number(value) * 1000
    : /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value) ? Date.parse(value) - Date.now()
      : NaN;
  if (Number.isSafeInteger(delay) && delay > 0) return delay;
}

const maxDiagnosticBytes = 16 * 1024;
async function readError(response: Response): Promise<Record<string, unknown> | undefined> {
  const reader = response.body?.getReader();
  if (!reader) return;
  let size = 0, text = '';
  const decoder = new TextDecoder();
  let stopDeadline: (() => void) | undefined;
  // Keep one absolute deadline even if a peer trickles body bytes.
  const deadline = new Promise<undefined>(resolve => {
    const timer = setTimeout(resolve, 1_000);
    stopDeadline = () => clearTimeout(timer);
  });
  try {
    for (;;) {
      const next = await Promise.race([reader.read(), deadline]);
      if (!next) return;
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maxDiagnosticBytes) return;
      text += decoder.decode(next.value, { stream: true });
    }
    const body = record(JSON.parse(text + decoder.decode()));
    return record(body?.error) ?? body;
  } catch { return; }
  finally {
    stopDeadline?.();
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function httpFailure(response: Response): Promise<LlmFailure> {
  const { status } = response;
  let code: BuiltinLlmFailureCode;
  switch (status) {
    case 401:
    case 403: code = 'AUTH'; break;
    case 402: code = 'QUOTA'; break;
    case 408: code = 'TIMEOUT'; break;
    case 429: code = 'RATE_LIMIT'; break;
    case 500:
    case 502:
    case 503: code = 'SERVER'; break;
    case 504: code = 'TIMEOUT'; break;
    case 400:
    case 413:
    case 422: code = 'INVALID_REQUEST'; break;
    default: code = `HTTP_${status}`;
  }
  const error = await readError(response);
  const structured = structuredCode(error);
  const message = typeof error?.message === 'string' ? error.message : '';
  // Status owns HTTP retry eligibility. Permanent quota or request details can narrow it,
  // but an error body cannot turn e.g. 403 into a retryable server error.
  if (status !== 401 && status !== 403 && status !== 402) {
    if (structured && structured !== 'SERVER' && structured !== 'RATE_LIMIT') code = structured;
    else if (status === 429 && isQuotaExceededError(message)) code = 'QUOTA';
    else if (code === 'INVALID_REQUEST' && isContextWindowExceededError(message)) code = 'CONTEXT_WINDOW_EXCEEDED';
  }
  const delay = grokRetryPolicy.mode === 'normal' && grokRetryPolicy.retryableCodes.includes(code) ? retryAfter(response.headers) : undefined;
  return grokFailure(code, { status, ...(delay === undefined ? {} : { providerRetryAfterMs: delay }) });
}

function streamFailure(event: unknown, eventName?: string): LlmFailure | undefined {
  const data = record(event);
  if (eventName === 'error' || data?.type === 'error' || data?.error) {
    return grokFailure(structuredCode(record(data?.error) ?? data) ?? 'PI_AI_ERROR');
  }
  if (data?.type === 'response.failed' || eventName === 'response.failed') {
    return grokFailure(structuredCode(record(record(data?.response)?.error)) ?? 'PI_AI_ERROR');
  }
  const response = record(data?.response);
  if (data?.type === 'response.incomplete' || eventName === 'response.incomplete') {
    if (record(response?.incomplete_details)?.reason === 'content_filter') return grokFailure('CONTENT_REFUSED');
  }
  if (data?.type === 'response.completed' && response?.status === 'failed') {
    return grokFailure(structuredCode(record(response.error)) ?? 'UNKNOWN');
  }
}

export function observeGrokEvent(event: unknown): void {
  const attempt = grokAttempt.getStore();
  if (attempt) attempt.failure ??= streamFailure(event);
}

const timeoutCodes = new Set(['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT']);
const transportCodes = new Set(['ECONNRESET', 'ECONNABORTED', 'EPIPE', 'EAI_AGAIN', 'UND_ERR_SOCKET', 'ERR_STREAM_PREMATURE_CLOSE']);
function networkFailure(value: unknown): BuiltinLlmFailureCode | undefined {
  for (let depth = 0; depth < 5 && value instanceof Error; depth++, value = value.cause) {
    const code = 'code' in value ? value.code : undefined;
    if (typeof code !== 'string') continue;
    if (timeoutCodes.has(code)) return 'TIMEOUT';
    if (transportCodes.has(code)) return 'TRANSPORT';
  }
}

// OpenAI's SDK intercepts `event: error` / top-level `error` *before* pi-ai's
// onProviderStreamEvent hook. Inspect a bounded copy of only the current SSE frame
// without teeing or consuming ahead of the SDK; regular output bytes stay untouched.
function observeSse(response: Response, attempt: Attempt): Response {
  if (!response.body) return response;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let line = '', data = '', eventName: string | undefined, oversized = false, sawCR = false;
  function inspect(text: string) {
    for (const char of text) {
      if (char === '\r' || char === '\n') {
        if (char === '\n' && sawCR) { sawCR = false; continue; }
        sawCR = char === '\r';
        if (!line) {
          const explicitFailure = eventName === 'error' || eventName === 'response.failed';
          if (!attempt.failure && !oversized && data && data.trim() !== '[DONE]') {
            try { attempt.failure = streamFailure(JSON.parse(data), eventName); }
            catch { if (explicitFailure) attempt.failure = grokFailure('PI_AI_ERROR'); }
          } else if (explicitFailure) {
            attempt.failure ??= grokFailure('PI_AI_ERROR');
          }
          data = ''; eventName = undefined; oversized = false;
        } else if (!oversized && line.startsWith('event:')) {
          eventName = line.slice(6).replace(/^ /, '');
        } else if (!oversized && line.startsWith('data:')) {
          data += line.slice(5).replace(/^ /, '') + '\n';
        }
        line = '';
      } else {
        sawCR = false;
        if (line.length + data.length >= maxDiagnosticBytes) oversized = true;
        // Keep a marker so an oversized line does not look like a frame delimiter.
        if (!oversized || !line) line += char;
      }
    }
  }
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      let result: ReadableStreamReadResult<Uint8Array>;
      try { result = await reader.read(); }
      catch (error) {
        const code = networkFailure(error);
        if (code) attempt.failure ??= grokFailure(code);
        reader.releaseLock();
        controller.error(new Error('Grok response body could not be read.'));
        return;
      }
      if (result.done) {
        attempt.eof = true;
        reader.releaseLock();
        controller.close();
        return;
      }
      inspect(decoder.decode(result.value, { stream: true }));
      controller.enqueue(result.value);
    },
    cancel() {
      // cancel() settles any pending read synchronously before it releases the lock.
      const cancelled = reader.cancel();
      reader.releaseLock();
      return cancelled;
    },
  }, { highWaterMark: 0 });
  return new Response(body, { status: response.status, headers: response.headers });
}

export const fetchGrokResponses: typeof fetch = async (input, init) => {
  const attempt = grokAttempt.getStore();
  try {
    // Bridge only normalized connection facts across the SDK's error wrapping.
    const response = await fetchGrok(input, init, attempt && (failure => { attempt.failure ??= failure; }), attempt && (() => {
      try { attempt.beforeDispatch(); }
      catch (error) {
        attempt.guardFailure = error instanceof LlmError && (error.code === 'AUTH' || error.code === 'TRANSPORT')
          ? error.failure : grokFailure('UNKNOWN');
        throw new Error('Grok Responses dispatch was blocked.');
      }
    }));
    if (!attempt) return response;
    if (!response.ok) {
      attempt.failure = await httpFailure(response);
      // Do not pass a raw HTTP error on to the SDK's formatting or logging.
      throw new Error('Grok Responses returned an HTTP error.');
    }
    return response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() === 'text/event-stream'
      ? observeSse(response, attempt) : response;
  } catch (error) {
    const code = networkFailure(error);
    if (attempt && code) attempt.failure ??= grokFailure(code);
    throw new Error('Grok Responses transport failed.');
  }
};

export function allowLocalTools(payload: unknown): void {
  const tools = record(payload)?.tools;
  if (tools === undefined || (Array.isArray(tools) && tools.every(tool => record(tool)?.type === 'function'))) return;
  const attempt = grokAttempt.getStore();
  if (attempt) attempt.failure = grokFailure('UNSUPPORTED_OPTION');
  // A server-side tool could already have run by the time a retryable failure reaches DSH.
  throw new Error('Grok supports only DSH-executed function tools.');
}
