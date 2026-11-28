import { LlmError } from '@deepseek-ai/dsh-llm';

export const CODEX_CONNECTION_FAILED = 'CODEX_CONNECTION_FAILED';

const unreachableCodes = new Set(['ENETUNREACH', 'EHOSTUNREACH', 'ENETDOWN']);
const accessor = Symbol('unread error accessor');

function ownData(object: object, key: string | number): unknown {
  const property = Object.getOwnPropertyDescriptor(object, key);
  return property === undefined ? undefined : 'value' in property ? property.value : accessor;
}

/** Classify only a rejected fetch before HTTP response handling, not a body or stream error. */
export function codexConnectionFailure(error: unknown): LlmError | undefined {
  // Node and undici errors have own data properties. Never inspect messages, stacks, or payloads.
  // Bound traversal for malformed cause graphs, including cycles.
  let remaining = 32;
  function isConnectionFailure(value: unknown): boolean {
    if (--remaining < 0 || !(value instanceof Error) || value instanceof LlmError) return false;
    if (ownData(value, 'status') !== undefined || ownData(value, 'statusCode') !== undefined) return false;
    const code = ownData(value, 'code');
    const syscall = ownData(value, 'syscall');
    const recognized = typeof code === 'string' && (code === 'EAI_AGAIN'
      ? syscall === undefined || syscall === 'getaddrinfo'
      : unreachableCodes.has(code) && (syscall === undefined || syscall === 'connect'));
    // A decisive outer error (e.g. TLS, proxy rejection, or timeout) is not a transparent wrapper.
    if (code === undefined ? syscall !== undefined : !recognized) return false;
    const cause = ownData(value, 'cause');
    if (cause !== undefined && !isConnectionFailure(cause)) return false;
    if (value instanceof AggregateError) {
      // Node's multi-address AggregateError.code copies the first member, not the whole result.
      const errors = ownData(value, 'errors');
      if (!Array.isArray(errors)) return false;
      const count = ownData(errors, 'length');
      if (typeof count !== 'number' || count === 0 || count > remaining) return false;
      for (let index = 0; index < count; index++) {
        if (!isConnectionFailure(ownData(errors, index))) return false;
      }
      return true;
    }
    return cause !== undefined || recognized;
  }

  try {
    if (!isConnectionFailure(error)) return;
  } catch {
    // Exotic thrown values (e.g. revoked proxies) must not mask the original failure.
    return;
  }
  return LlmError.fromFailure({ code: CODEX_CONNECTION_FAILED, message: '无法建立 Codex 连接，正在等待网络。' });
}
