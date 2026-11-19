import { LlmError } from '@deepseek-ai/dsh-llm';
import type { GenerateOptions, ToolSchema } from '@deepseek-ai/dsh-llm';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { Options, SDKUserMessage } from '@qoder-ai/qoder-agent-sdk';

export function buildPrompt(options: GenerateOptions) {
  if (options.temperature !== undefined || options.stop?.length) {
    throw new LlmError('Qoder SDK 不支持 temperature 或 stop 参数。', 'UNSUPPORTED_OPTION');
  }

  const instructions = options.system ? [options.system] : [];
  const conversation = [];
  for (const message of options.messages) {
    const content = [];
    for (const block of message.content) {
      switch (block.type) {
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
      instructions.push(...content.flatMap(block => block.type === 'text' ? [block.text] : []));
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
  const input: SDKUserMessage = {
    type: 'user',
    client_composed: true,
    parent_tool_use_id: null,
    message: { role: 'user', content: JSON.stringify(conversation) },
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
