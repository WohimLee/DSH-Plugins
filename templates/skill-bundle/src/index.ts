import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-skill';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const name = 'dsh-{{slug}}';
export const inject = ['skills'];
export async function apply(ctx: Context): Promise<void> {
  const file = new URL('../skills/{{slug}}/SKILL.md', import.meta.url);
  ctx.skills.register({
    name: '{{slug}}', description: 'Explain the purpose and limitations of this example skill.',
    source: 'bundled', provider: name,
    resourceBase: { kind: 'directory', path: fileURLToPath(new URL('../skills/{{slug}}/', import.meta.url)) },
    content: await readFile(file, 'utf8'),
  });
}
