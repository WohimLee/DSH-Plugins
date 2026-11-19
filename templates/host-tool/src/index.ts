import type { Context } from '@deepseek-ai/cordis';
import { defineTool } from '@deepseek-ai/dsh-tools';

export const name = 'dsh-{{slug}}';
export const inject = ['tools'];

export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: '{{slug}}'.replaceAll('-', '_') + '_echo',
    description: 'Return the supplied text unchanged.',
    parameters: { text: { type: 'string', required: true } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) { return args.text; },
  }));
}
