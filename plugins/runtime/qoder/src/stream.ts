import { LlmError, ToolCallId } from '@deepseek-ai/dsh-llm';
import type { StreamChunk, ToolCallBlock } from '@deepseek-ai/dsh-llm';
import type { SDKMessage } from '@qoder-ai/qoder-agent-sdk';

type TextBlock = { type: 'text' | 'reasoning'; text: string };

export function authError(): LlmError {
  return new LlmError('Qoder 登录失效或无访问权限。请在 Qoder CLI 重新登录或更新 QODER_PERSONAL_ACCESS_TOKEN。', 'AUTH');
}

function responseError(code: unknown): LlmError | undefined {
  switch (code) {
    case 'authentication_failed':
    case 401:
    case 403:
      return authError();
    case 'rate_limit':
    case 429:
      return new LlmError('Qoder 请求频率或用量已达限制。', 'RATE_LIMIT');
    case 'server_error':
    case 500:
    case 502:
    case 503:
    case 504:
      return new LlmError('Qoder 服务暂时不可用。', 'SERVER');
    case 'billing_error':
      return new LlmError('Qoder 账户额度不足，请检查账户用量。', 'QUOTA');
    case 'invalid_request':
      return new LlmError('Qoder 拒绝了模型请求，请检查模型档位及参数。', 'INVALID_REQUEST');
    default:
      return undefined;
  }
}

function queueError(details: readonly unknown[]): LlmError | undefined {
  // Match only the CLI's known queue failure, never forward upstream diagnostics.
  if (!details.some(detail => typeof detail === 'string' &&
      /^(?:API Error:\s*)?Model queue recovery attempts exceeded\.?$/i.test(detail.trim()))) return;
  // The CLI already exhausted queue recovery; don't invoke DSH's default retry policy again.
  return LlmError.fromFailure({
    code: 'QODER_MODEL_QUEUE_EXHAUSTED',
    message: 'Qoder 模型排队未能完成。请稍后重试，或在输入框切换模型后再发。',
  });
}

function unknownResponseError(): LlmError {
  return new LlmError('Qoder 未能完成模型请求。', 'UNKNOWN');
}

function tokenCount(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export async function* readResponse(
  messages: AsyncIterable<SDKMessage>,
  toolNames: ReadonlyMap<string, string>,
  signal: AbortSignal,
): AsyncGenerator<StreamChunk> {
  let index = 0;
  let active: { index: number; upstreamIndex: number | undefined; block: TextBlock } | undefined;
  let startedText = false;
  let stopReason: string | null | undefined;
  let assistantFailure: LlmError | undefined;
  const streamed: TextBlock[] = [];
  const calls = new Map<string, ToolCallBlock>();

  function* closeText(confirm = false): Generator<StreamChunk> {
    if (!active) return;
    if (confirm) streamed.push(active.block);
    yield { type: 'block-end', index: active.index, block: active.block };
    active = undefined;
  }

  function* appendText(type: TextBlock['type'], text: string, upstreamIndex?: number): Generator<StreamChunk> {
    if (!text) return;
    if (active?.block.type !== type || active?.upstreamIndex !== upstreamIndex) {
      yield* closeText(true);
      active = { index: index++, upstreamIndex, block: { type, text: '' } };
      yield { type: 'block-start', index: active.index, blockType: type };
    }
    startedText = true;
    active.block.text += text;
    yield { type: type === 'text' ? 'text-delta' : 'reasoning-delta', index: active.index, text };
  }

  for await (const message of messages) {
    signal.throwIfAborted();
    if (message.type === 'stream_event' && !message.parent_tool_use_id) {
      const event = message.event;
      if (event.type === 'content_block_start' && event.content_block) {
        const block = event.content_block;
        if (block.type === 'text' && typeof block.text === 'string') {
          yield* appendText('text', block.text, event.index);
        } else if (block.type === 'thinking' && typeof block.thinking === 'string') {
          yield* appendText('reasoning', block.thinking, event.index);
        }
      } else if (event.type === 'content_block_delta') {
        const delta = event.delta as { type?: string; text?: string; thinking?: string } | undefined;
        if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
          yield* appendText('text', delta.text, event.index);
        } else if (delta?.type === 'thinking_delta' && typeof delta.thinking === 'string') {
          yield* appendText('reasoning', delta.thinking, event.index);
        }
      } else if (event.type === 'content_block_stop' && active?.upstreamIndex === event.index) {
        yield* closeText(true);
      } else if (event.type === 'message_delta') {
        const delta = event.delta as { stop_reason?: string } | undefined;
        if (delta?.stop_reason) stopReason = delta.stop_reason;
      }
      continue;
    }

    if (message.type === 'assistant' && !message.parent_tool_use_id) {
      if (message.error || message.isApiErrorMessage) {
        const knownFailure = responseError(message.error);
        if (knownFailure) throw knownFailure;
        // A synthetic assistant error can precede the terminal result with more detail.
        assistantFailure = queueError(message.message.content.map(block => block.type === 'text' ? block.text : undefined))
          ?? assistantFailure ?? unknownResponseError();
        continue;
      }
      stopReason = message.message.stop_reason ?? stopReason;
      for (const block of message.message.content) {
        if (block.type === 'tool_use') {
          const name = typeof block.name === 'string' ? toolNames.get(block.name) : undefined;
          if (!name || typeof block.id !== 'string' || !block.id ||
              !block.input || typeof block.input !== 'object' || Array.isArray(block.input)) {
            throw new LlmError('Qoder 返回了未声明的工具或无效的工具参数。', 'INVALID_RESPONSE');
          }
          calls.set(block.id, { type: 'tool-call', id: ToolCallId(block.id), name, arguments: JSON.stringify(block.input) });
          continue;
        }

        const type = block.type === 'thinking' ? 'reasoning' : 'text';
        const fullText = block.type === 'thinking' ? block.thinking : block.type === 'text' ? block.text : undefined;
        if (typeof fullText !== 'string' || !fullText) continue;
        const previous = streamed[0];
        if (previous?.type === type && previous.text === fullText) {
          streamed.shift();
        } else if (active?.block.type === type && fullText.startsWith(active.block.text)) {
          yield* appendText(type, fullText.slice(active.block.text.length), active.upstreamIndex);
          yield* closeText();
        } else {
          yield* closeText(true);
          yield* appendText(type, fullText);
          yield* closeText();
        }
      }
      continue;
    }

    if (message.type !== 'result') continue;
    if ((message.subtype !== 'success' || message.is_error) &&
        !(message.subtype === 'error_max_turns' && calls.size)) {
      const details = message.subtype === 'success' ? [message.result] : [message.error_message, ...(message.errors ?? [])];
      throw responseError(message.error_code) ?? queueError(details) ?? assistantFailure ?? unknownResponseError();
    }
    if (assistantFailure) throw assistantFailure;

    yield* closeText();
    stopReason = message.stop_reason ?? stopReason;
    if (message.subtype === 'success' && !startedText && !calls.size && typeof message.result === 'string') {
      yield* appendText('text', message.result);
      yield* closeText();
    }
    if (stopReason === 'max_tokens') {
      calls.clear();
    } else if (stopReason === 'tool_use' && !calls.size) {
      throw new LlmError('Qoder 未返回完整的工具调用。', 'INVALID_RESPONSE');
    } else if (stopReason === 'refusal' && !startedText) {
      throw new LlmError('Qoder 拒绝回答此请求。', 'CONTENT_REFUSED');
    } else if (!startedText && !calls.size) {
      throw new LlmError('Qoder 返回了空响应。', 'EMPTY_RESPONSE');
    }
    for (const block of calls.values()) {
      yield { type: 'block-start', index, blockType: 'tool-call' };
      yield { type: 'tool-call-delta', index, id: block.id, name: block.name, argumentsDelta: block.arguments };
      yield { type: 'block-end', index: index++, block };
    }
    if (message.usage) {
      yield { type: 'usage', usage: {
        inputTokens: tokenCount(message.usage.input_tokens),
        outputTokens: tokenCount(message.usage.output_tokens),
        cacheReadTokens: tokenCount(message.usage.cache_read_input_tokens),
        cacheWriteTokens: tokenCount(message.usage.cache_creation_input_tokens),
      } };
    }
    yield { type: 'finish', reason: { kind: calls.size ? 'tool-calls' : stopReason === 'max_tokens' ? 'max-tokens' : 'stop' } };
    return;
  }
  signal.throwIfAborted();
  throw assistantFailure ?? new LlmError('Qoder 响应在返回结束事件前中断。', 'INVALID_RESPONSE');
}
