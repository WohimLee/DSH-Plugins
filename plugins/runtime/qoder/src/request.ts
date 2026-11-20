import { LlmError, requestImageHandleText, offloadedImageText } from '@deepseek-ai/dsh-llm';
import type { GenerateOptions, ToolSchema } from '@deepseek-ai/dsh-llm';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { Context } from '@deepseek-ai/cordis';
import type { ImageContentBlock, Options, SDKUserMessage } from '@qoder-ai/qoder-agent-sdk';

export async function buildPrompt(options: GenerateOptions, imageStore?: Pick<Context['attachments'], 'readImageRequest'>) {
  if (options.temperature !== undefined || options.stop?.length) {
    throw new LlmError('Qoder SDK 不支持 temperature 或 stop 参数。', 'UNSUPPORTED_OPTION');
  }

  const instructions = options.system ? [options.system] : [];
  const conversation = [];
  const images: ImageContentBlock[] = [];
  for (const message of options.messages) {
    const content = [];
    for (const block of message.content) {
      switch (block.type) {
        case 'image': {
          if (message.role !== 'user' && message.role !== 'tool') {
            throw new LlmError('Qoder 仅允许用户消息和工具结果包含图片。', 'UNSUPPORTED_CONTENT');
          }
          if (block.offloaded) {
            content.push({ type: 'text', text: offloadedImageText(block.attachment) });
            break;
          }
          if (!imageStore) throw new LlmError('当前 Qoder 账号模型接入仅提供文本输入。', 'UNSUPPORTED_CONTENT');
          const ref = block.attachment;
          const version = await imageStore.readImageRequest(ref, {
            width: ref.width, height: ref.height, maxBytes: ref.bytes,
          }, options.signal);
          images.push({ type: 'image', source: {
            type: 'base64', media_type: version.mediaType, data: Buffer.from(version.data).toString('base64'),
          } });
          content.push({ type: 'image', index: images.length, description: requestImageHandleText(ref, version) });
          break;
        }
        case 'text':
        case 'tool-call':
          content.push(block);
          break;
        case 'reasoning':
        case 'tool-addition':
        case 'tool-removal':
          break;
        default:
          throw new LlmError('Qoder 插件仅接收文本及 DSH 工具记录。', 'UNSUPPORTED_CONTENT');
      }
    }

    if (message.role === 'system') {
      instructions.push(...content.flatMap(block => block.type === 'text' && typeof block.text === 'string' ? [block.text] : []));
    } else if (message.role === 'tool') {
      conversation.push({ role: message.role, content, toolCallId: message.toolCallId, isError: message.isError });
    } else if (content.length) {
      conversation.push({ role: message.role, content });
    }
  }

  instructions.push(
    'The user input is a JSON transcript from DSH, in chronological order. Continue the conversation from its end. ' +
    'Use the role fields to distinguish instruction, user, assistant and tool messages. ' +
    'Each tool message records the outcome of its matching tool call in this conversation.',
  );
  if (images.length) instructions.push('Each image index in the transcript refers to the corresponding subsequent image block, starting at 1.');
  const transcript = JSON.stringify(conversation);
  const input: SDKUserMessage = {
    type: 'user',
    client_composed: true,
    parent_tool_use_id: null,
    message: { role: 'user', content: images.length ? [{ type: 'text', text: transcript }, ...images] : transcript },
  };
  return { input, systemPrompt: instructions.join('\n\n') };
}

export function advertiseTools(tools: readonly ToolSchema[] = []) {
  const toolNames = new Map<string, string>();
  const catalog = tools.map((tool, index) => {
    const name = `tool_${index + 1}`;
    toolNames.set(`mcp__dsh__${name}`, tool.name);
    return {
      name,
      description: `${tool.name}: ${tool.description}`,
      inputSchema: { ...tool.parameters, type: 'object' as const },
    };
  });

  let mcpServers: Options['mcpServers'] = {};
  if (catalog.length) {
    const instance = new McpServer({ name: 'dsh', version: '1.0.0' }, { capabilities: { tools: {} } });
    // Use MCP's list handler to preserve the host's JSON Schema exactly.
    instance.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: catalog }));
    instance.server.setRequestHandler(CallToolRequestSchema, async () => ({
      isError: true,
      content: [{ type: 'text', text: 'DSH handles tool execution after this model turn.' }],
    }));
    mcpServers = {
      dsh: {
        type: 'sdk',
        name: 'dsh',
        instance,
        tools: catalog.map(tool => ({ name: tool.name, alwaysLoad: true })),
      },
    };
  }
  return { mcpServers, toolNames };
}
