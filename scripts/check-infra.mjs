import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { ROOT, readJson } from './plugin-lib.mjs';
import { checkDshVersion } from './check-dsh-version.mjs';
await checkDshVersion();
const required = ['AGENTS.md', 'CLAUDE.md', 'CONTRIBUTING.md', 'pnpm-lock.yaml', 'plugins/AGENTS.md',
  '.agents/INITIALIZE.md', '.agents/README.md', '.agents/notes/README.md', '.agents/notes/template.md',
  'docs/project-context.md', 'docs/architecture.md', 'docs/development.md', 'docs/testing.md',
  'docs/compatibility.md', 'docs/plugin-categories.md', 'docs/security.md', 'docs/releasing.md', 'docs/plugins.md'];
for (const path of required) if (!(await stat(resolve(ROOT, path))).size) throw new Error(`Missing or empty: ${path}`);
async function walk(path) {
  const files = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && !['.agents', '.github'].includes(entry.name)) continue;
    if (['node_modules', 'lib', 'dist', 'coverage', 'templates'].includes(entry.name)) continue;
    const file = resolve(path, entry.name);
    if (entry.isDirectory()) files.push(...await walk(file));
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(file);
  }
  return files;
}
for (const path of await walk(ROOT)) {
  const text = await readFile(path, 'utf8');
  if (/\{\{[^}]+\}\}|xxx-/.test(text)) throw new Error(`Unresolved placeholder: ${path}`);
  if (/\/Users\/|\/home\/[^/]+\//.test(text)) throw new Error(`Personal absolute path: ${path}`);
  for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const link = match[1];
    if (/^(?:[a-z]+:|#)/i.test(link)) continue;
    const target = decodeURIComponent(link.split('#')[0]);
    if (target && !(await stat(resolve(dirname(path), target))).isFile()) throw new Error(`Broken link in ${path}: ${link}`);
  }
}
for (const name of ['dshp-code-review', 'dshp-pre-push-checks']) {
  const text = await readFile(resolve(ROOT, '.agents/skills', name, 'SKILL.md'), 'utf8');
  if (!text.startsWith(`---\nname: ${name}\ndescription: `)) throw new Error(`Skill metadata mismatch: ${name}`);
}
const pkg = await readJson(resolve(ROOT, 'package.json'));
if (pkg.private !== true || pkg.packageManager !== 'pnpm@11.7.0') throw new Error('Root must be private with pinned pnpm.');
const base = await readJson(resolve(ROOT, 'tsconfig.base.json'));
for (const shape of ['host-tool', 'client-ui', 'full-stack', 'skill-bundle']) {
  const config = await readJson(resolve(ROOT, 'templates', shape, 'tsconfig.json'));
  for (const [key, value] of Object.entries(base.compilerOptions)) {
    if (JSON.stringify(config.compilerOptions[key]) !== JSON.stringify(value)) throw new Error(`TypeScript defaults drifted: ${shape}/${key}`);
  }
}
console.log('Agent infrastructure passed (required files, Markdown file links, placeholders, skill metadata).');
