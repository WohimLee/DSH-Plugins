import { isQuotaExceededError, LlmError } from '@deepseek-ai/dsh-llm';
import type { SDKResultMessage } from '@qoder-ai/qoder-agent-sdk';
import {
  AuthAccessTokenEnvVarError, AuthServiceAccountEnvVarError, ControlRequestError,
  DaemonHeartbeatTimeoutError, FrameTooLargeError, ProtocolVersionMismatchError,
  QoderCliInitializationError, UnsupportedCliCapabilityError,
} from '@qoder-ai/qoder-agent-sdk';

export const retryableRequestCodes = ['RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT', 'EMPTY_RESPONSE'];

export function authError(): LlmError {
  return new LlmError('Qoder 登录失效或无访问权限。请在 Qoder CLI 重新登录或更新 QODER_PERSONAL_ACCESS_TOKEN。', 'AUTH');
}

export function unknownResponseError(): LlmError {
  return new LlmError('Qoder 未能完成模型请求。', 'UNKNOWN');
}

export function sessionCleanupError(): LlmError {
  return LlmError.fromFailure({
    code: 'QODER_SESSION_CLEANUP_FAILED',
    message: '未能确认 Qoder 会话已关闭，本次请求不会自动重试。',
  });
}

function responseError(code: unknown): LlmError | undefined {
  // SDK Result.error_code permits both numbers and strings; only recognize exact HTTP codes.
  if (typeof code === 'string' && /^[1-5]\d\d$/.test(code)) code = Number(code);
  switch (code) {
    case 'authentication_failed':
    case 401:
    case 403:
      return authError();
    case 'rate_limit':
    case 429:
      return new LlmError('Qoder 请求频率已达限制。', 'RATE_LIMIT');
    case 408:
      return new LlmError('Qoder 模型请求超时。', 'TIMEOUT');
    case 'server_error':
    case 500:
    case 502:
    case 503:
    case 504:
      return new LlmError('Qoder 服务暂时不可用。', 'SERVER');
    case 'billing_error':
    case 402:
      return new LlmError('Qoder 账户额度不足，请检查账户用量。', 'QUOTA');
    case 'invalid_request':
    case 'max_output_tokens':
    case 400:
    case 404:
    case 422:
      return new LlmError('Qoder 拒绝了模型请求，请检查模型档位及参数。', 'INVALID_REQUEST');
    default:
      return undefined;
  }
}

export function modelResponseError(code: unknown, details: readonly unknown[]): LlmError | undefined {
  const known = responseError(code);
  if (known && ['AUTH', 'QUOTA', 'INVALID_REQUEST'].includes(known.code)) return known;
  // Only inspect marked SDK error frames. The CLI already exhausted queue recovery.
  if (details.some(detail => typeof detail === 'string' &&
      /^(?:API Error:\s*)?Model queue recovery attempts exceeded\.?$/i.test(detail.trim()))) {
    return LlmError.fromFailure({
      code: 'QODER_MODEL_QUEUE_EXHAUSTED',
      message: 'Qoder 模型排队未能完成。请稍后重试，或在输入框切换模型后再发。',
    });
  }
  if (details.some(detail => typeof detail === 'string' && isQuotaExceededError(detail))) {
    return responseError('billing_error');
  }
  return known;
}

export function modelResultError(result: SDKResultMessage): LlmError | undefined {
  const details = result.subtype === 'success' ? [result.result] : [result.error_message, ...(result.errors ?? [])];
  return modelResponseError(result.error_code, details) ??
    (result.error_code === undefined ? undefined : unknownResponseError());
}

export function preferModelFailure(terminal: LlmError | undefined, assistant: LlmError | undefined): LlmError | undefined {
  // An explicit terminal refusal outranks an earlier summary, but a generic
  // terminal 429/5xx must not turn an already exhausted queue into a retry.
  const permanent = (failure: LlmError | undefined) => failure &&
    ['AUTH', 'QUOTA', 'INVALID_REQUEST', 'QODER_MODEL_QUEUE_EXHAUSTED'].includes(failure.code);
  if (permanent(terminal)) return terminal;
  return permanent(assistant) ? assistant : terminal ?? assistant;
}

export function sdkRequestError(error: unknown): LlmError {
  if (error instanceof LlmError) return error;
  if (error instanceof QoderCliInitializationError) {
    return modelResultError(error.result) ?? unknownResponseError();
  }
  if (error instanceof ProtocolVersionMismatchError || error instanceof UnsupportedCliCapabilityError) {
    return new LlmError('Qoder CLI 与当前 SDK 不兼容，请检查 CLI 版本。', 'INVALID_CONFIG');
  }
  if (error instanceof FrameTooLargeError) {
    return error.direction === 'input'
      ? new LlmError('Qoder SDK 请求超过传输大小限制，请缩短输入。', 'INVALID_REQUEST')
      : new LlmError('Qoder SDK 响应超过传输大小限制。', 'INVALID_RESPONSE');
  }
  const code = error instanceof Error && 'code' in error ? error.code : undefined;
  if (error instanceof AuthAccessTokenEnvVarError || error instanceof AuthServiceAccountEnvVarError
      || code === 'auth_not_configured'
      || (error instanceof ControlRequestError && error.message.startsWith('Authentication required.'))) {
    return authError();
  }
  if (error instanceof DaemonHeartbeatTimeoutError || (error instanceof DOMException && error.name === 'TimeoutError')
      || code === 'ETIMEDOUT') {
    return new LlmError('Qoder 连接超时。', 'TIMEOUT');
  }
  if (code === 'EPIPE' || code === 'ECONNRESET' || code === 'EAI_AGAIN') {
    return new LlmError('Qoder 连接暂时中断。', 'TRANSPORT');
  }
  // A control operation's retryable flag is not a model-request verdict. Generic
  // process exits can also be caused by CLI/configuration errors, not a broken pipe.
  return unknownResponseError();
}
