import type { Context } from '@deepseek-ai/cordis';
import { LlmError, offloadedImageText, requestImageHandleText } from '@deepseek-ai/dsh-llm';
import type { GenerateOptions, ContentBlock, ImageBlock } from '@deepseek-ai/dsh-llm';

function text(blocks: readonly ContentBlock[]): string {
  return blocks.map(block => {
    if (block.type === 'text') return block.text;
    if (block.type === 'reasoning') return '';
    throw new LlmError('此消息包含 Codex 无法传递的内容。', 'UNSUPPORTED_CONTENT');
  }).join('');
}
type ReadImage = (ref: ImageBlock['attachment']) => ReturnType<Context['attachments']['readImageRequest']>;
type InputPart = { type: 'input_text'; text: string } | { type: 'input_image'; image_url: string };

export async function buildRequest(options: GenerateOptions, readImage?: ReadImage): Promise<Record<string, unknown>> {
  if (options.temperature !== undefined || options.stop?.length) {
    throw new LlmError('Codex 不支持此请求的 temperature 或 stop 参数。', 'UNSUPPORTED_OPTION');
  }
  const instructions: string[] = options.system === undefined ? [] : [options.system];
  const input: Record<string, unknown>[] = [];
  const imageUrls = new Map<string, { url: string; width: number; height: number }>();
  async function contentParts(blocks: readonly ContentBlock[]): Promise<InputPart[]> {
    const parts: InputPart[] = [];
    for (const block of blocks) {
      if (block.type !== 'image') {
        if (block.type !== 'reasoning') parts.push({ type: 'input_text', text: text([block]) });
        continue;
      }
      if (block.offloaded) {
        parts.push({ type: 'input_text', text: offloadedImageText(block.attachment) });
        continue;
      }
      if (!readImage) throw new LlmError('当前 Codex 接入无法读取此模型的图片输入。', 'UNSUPPORTED_CONTENT');
      const ref = block.attachment;
      let image = imageUrls.get(ref.attachmentId);
      if (!image) {
        const version = await readImage(ref);
        image = { url: `data:${version.mediaType};base64,${Buffer.from(version.data).toString('base64')}`,
          width: version.width, height: version.height };
        imageUrls.set(ref.attachmentId, image);
      }
      parts.push({ type: 'input_text', text: requestImageHandleText(ref, image) },
        { type: 'input_image', image_url: image.url });
    }
    return parts;
  }
  for (const message of options.messages) {
    if (message.role === 'system') { instructions.push(text(message.content)); continue; }
    if (message.role === 'tool') {
      const output = message.content.some(block => block.type === 'image')
        ? await contentParts(message.content) : text(message.content);
      input.push({ type: 'function_call_output', call_id: message.toolCallId, output });
    } else if (message.role === 'assistant') {
      for (const block of message.content) {
        if (block.type === 'tool-call') {
          input.push({ type: 'function_call', call_id: block.id, name: block.name, arguments: block.arguments });
        } else if (block.type === 'text') {
          input.push({ role: 'assistant', content: [{ type: 'output_text', text: block.text }] });
        } else if (block.type !== 'reasoning') text([block]);
      }
    } else {
      input.push({ role: message.role, content: await contentParts(message.content) });
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
    ...(options.reasoningEffort ? { reasoning: { effort: options.reasoningEffort } } : {}),
    // Codex backend manages the output budget; max_output_tokens is not a supported field.
  };
}
