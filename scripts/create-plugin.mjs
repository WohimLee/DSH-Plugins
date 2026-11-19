import { cp, readFile, writeFile, mkdir, readdir, rm, rename } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { ROOT, categories, shapes, slugPattern, scanPlugins } from './plugin-lib.mjs';
import { checkDshVersion } from './check-dsh-version.mjs';
export async function createPlugin(shape, category, slug, root = ROOT) {
  if (!shapes.includes(shape)) throw new Error(`Unknown template: ${shape}`);
  if (!categories.some(c => c.id === category)) throw new Error(`Unknown category: ${category}`);
  if (!slugPattern.test(slug ?? '') || slug.startsWith('dsh-')) throw new Error('Use a lowercase short slug without the dsh- prefix.');
  if ((await scanPlugins(root)).some(p => p.slug === slug)) throw new Error(`Plugin slug already exists: ${slug}`);
  const destination = resolve(root, 'plugins', category, slug);
  await mkdir(resolve(root, 'plugins', category), { recursive: true });
  // Exclusive mkdir reserves the target; never overwrite an existing directory.
  await mkdir(destination);
  try {
    const source = resolve(ROOT, 'templates', shape);
    for (const entry of await readdir(source)) {
      await cp(join(source, entry), join(destination, entry), { recursive: true, force: false, errorOnExist: true });
    }
    async function replace(path) {
      for (const entry of await readdir(path, { withFileTypes: true })) {
        const file = join(path, entry.name);
        if (entry.isDirectory()) {
          await replace(file);
          const newName = entry.name.replaceAll('{{slug}}', slug);
          if (newName !== entry.name) await rename(file, join(path, newName));
        }
        else await writeFile(file, (await readFile(file, 'utf8')).replaceAll('{{slug}}', slug).replaceAll('{{category}}', category));
      }
    }
    await replace(destination);
    return destination;
  } catch (error) { await rm(destination, { recursive: true, force: true }); throw error; }
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(ROOT, 'scripts/create-plugin.mjs')) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 3) throw new Error('Usage: pnpm create:plugin <host-tool|client-ui|full-stack|skill-bundle> <category> <slug>');
    await checkDshVersion();
    console.log(`Created ${await createPlugin(...args)}. Run pnpm install, edit the example, then pnpm catalog:generate.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
