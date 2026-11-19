import { LlmError, ToolCallId } from '@deepseek-ai/dsh-llm';
import type { StreamChunk, ContentBlock } from '@deepseek-ai/dsh-llm';
import { record } from './local.js';

// Bound one SSE frame so a malformed remote stream cannot grow memory indefinitely.
async function* frames(body: ReadableStream<Uint8Array>): AsyncGenerator<Record<string, unknown>> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const parse = (frame: string): Record<string, unknown> | undefined => {
    const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data || data === '[DONE]') return undefined;
    try { const value = record(JSON.parse(data)); if (typeof value.type === 'string') return value; } catch { /* safe diagnostic below */ }
    throw new LlmError('Codex 返回了无效的 SSE 数据。', 'INVALID_RESPONSE');
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, '\n');
      let end: number;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        if (frame.length > 8 * 1024 * 1024) throw new LlmError('Codex SSE 帧超过限制。', 'INVALID_RESPONSE');
        const event = parse(frame); if (event) yield event;
      }
      if (buffer.length > 8 * 1024 * 1024) throw new LlmError('Codex SSE 帧超过限制。', 'INVALID_RESPONSE');
      if (done) { if (buffer.trim()) { const event = parse(buffer); if (event) yield event; } return; }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export async function* parseStream(body: ReadableStream<Uint8Array>): AsyncGenerator<StreamChunk> {
  let nextIndex = 0, sawTool = false;
  let active: { index: number; type: 'text' | 'reasoning'; text: string } | undefined;
  function* close(): Generator<StreamChunk> {
    if (active) { yield { type: 'block-end', index: active.index, block: { type: active.type, text: active.text } }; active = undefined; }
  }
  try {
    for await (const event of frames(body)) {
      const type = event.type;
      if (type === 'response.output_text.delta' || type === 'response.reasoning_summary_text.delta' || type === 'response.reasoning_text.delta') {
        if (typeof event.delta !== 'string') throw new LlmError('Codex 文本增量格式错误。', 'INVALID_RESPONSE');
        const blockType = type === 'response.output_text.delta' ? 'text' : 'reasoning';
        if (active?.type !== blockType) {
          yield* close(); active = { index: nextIndex++, type: blockType, text: '' };
          yield { type: 'block-start', index: active.index, blockType };
        }
        active.text += event.delta;
        yield { type: blockType === 'text' ? 'text-delta' : 'reasoning-delta', index: active.index, text: event.delta };
      } else if (type === 'response.output_item.done') {
        const item = record(event.item);
        if (item.type === 'function_call') {
          if (typeof item.call_id !== 'string' || !item.call_id || typeof item.name !== 'string' || !item.name || typeof item.arguments !== 'string') {
            throw new LlmError('Codex 工具调用格式错误。', 'INVALID_RESPONSE');
          }
          yield* close(); sawTool = true;
          const index = nextIndex++, id = ToolCallId(item.call_id);
          const block: ContentBlock = { type: 'tool-call', id, name: item.name, arguments: item.arguments };
          yield { type: 'block-start', index, blockType: 'tool-call' };
          yield { type: 'tool-call-delta', index, id, name: item.name, argumentsDelta: item.arguments };
          yield { type: 'block-end', index, block };
        }
      } else if (type === 'response.completed' || type === 'response.incomplete') {
        yield* close();
        const response = record(event.response), usage = record(response.usage);
        const cached = record(usage.input_tokens_details).cached_tokens ?? 0;
        if ([usage.input_tokens, usage.output_tokens, cached].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0)
          && (cached as number) <= (usage.input_tokens as number)) {
          yield { type: 'usage', usage: { inputTokens: (usage.input_tokens as number) - (cached as number),
            outputTokens: usage.output_tokens as number, cacheReadTokens: cached as number,
            totalTokens: (usage.input_tokens as number) + (usage.output_tokens as number) } };
        }
        if (type === 'response.incomplete' && record(response.incomplete_details).reason !== 'max_output_tokens') {
          throw new LlmError('Codex 响应未完成。', 'INVALID_RESPONSE');
        }
        yield { type: 'finish', reason: { kind: type === 'response.incomplete' ? 'max-tokens' : sawTool ? 'tool-calls' : 'stop' } }; return;
      } else if (type === 'error' || type === 'response.failed') {
        // Provider payloads can echo prompts or credentials; retain only safe taxonomy.
        throw new LlmError('Codex 服务返回响应失败。', 'UNKNOWN');
      } else if (type === 'response.refusal.delta') {
        throw new LlmError('Codex 拒绝了此请求。', 'INVALID_REQUEST');
      }
    }
    throw new LlmError('Codex 响应流中断，未收到结束帧。', 'TRANSPORT');
  } catch (error) { yield* close(); throw error; }
}
