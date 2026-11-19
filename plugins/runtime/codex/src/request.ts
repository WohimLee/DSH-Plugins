import { LlmError } from '@deepseek-ai/dsh-llm';
import type { GenerateOptions, ContentBlock } from '@deepseek-ai/dsh-llm';

function text(blocks: readonly ContentBlock[]): string {
  return blocks.map(block => {
    if (block.type === 'text') return block.text;
    if (block.type === 'reasoning') return '';
    throw new LlmError('Codex 首版仅支持文本输入；请移除图片或其他未支持的内容。', 'UNSUPPORTED_CONTENT');
  }).join('');
}
export function buildRequest(options: GenerateOptions): Record<string, unknown> {
  if (options.temperature !== undefined || options.stop?.length) {
    throw new LlmError('Codex 不支持此请求的 temperature 或 stop 参数。', 'UNSUPPORTED_OPTION');
  }
  const instructions: string[] = options.system === undefined ? [] : [options.system];
  const input: Record<string, unknown>[] = [];
  for (const message of options.messages) {
    if (message.role === 'system') { instructions.push(text(message.content)); continue; }
    if (message.role === 'tool') {
      input.push({ type: 'function_call_output', call_id: message.toolCallId, output: text(message.content) });
    } else if (message.role === 'assistant') {
      for (const block of message.content) {
        if (block.type === 'tool-call') {
          input.push({ type: 'function_call', call_id: block.id, name: block.name, arguments: block.arguments });
        } else if (block.type === 'text') {
          input.push({ role: 'assistant', content: [{ type: 'output_text', text: block.text }] });
        } else if (block.type !== 'reasoning') text([block]);
      }
    } else {
      input.push({ role: message.role, content: [{ type: 'input_text', text: text(message.content) }] });
    }
  }
  const tools = options.tools?.map(tool => {
    const schema = tool.parameters;
    if ((schema.type !== undefined && schema.type !== 'object') || ['oneOf','anyOf','allOf','enum','const','not'].some(key => Object.hasOwn(schema, key))) {
      throw new LlmError('Codex 工具参数必须为不含顶层组合约束的 object schema。', 'INVALID_REQUEST');
    }
    const properties = { ...schema.properties as Record<string, unknown> | undefined };
    if (Array.isArray(schema.required)) for (const key of schema.required) {
      if (typeof key === 'string' && !Object.hasOwn(properties, key)) Object.defineProperty(properties, key, { value: {}, enumerable: true });
    }
    return { type: 'function', name: tool.name, description: tool.description, parameters: { ...schema, type: 'object', properties }, strict: false };
  });
  return { model: options.model, stream: true, store: false, instructions: instructions.join('\n\n'), input,
    ...(tools?.length ? { tools } : {}),
    ...(options.reasoningEffort ? { reasoning: { effort: options.reasoningEffort, summary: 'auto' } } : {}),
    // Codex backend manages the output budget; max_output_tokens is not a supported field.
  };
}
