import { readFile, readdir, lstat } from 'node:fs/promises';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import semver from 'semver';
import { parse } from 'yaml';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
export const categories = await readJson(resolve(ROOT, 'docs/plugin-categories.json'));
export const slugPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
export const shapes = ['host-tool', 'client-ui', 'full-stack', 'skill-bundle'];
export const isDshPackage = name => name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-');
export function inside(base, path) {
  const rel = relative(base, path);
  return rel !== '..' && !rel.startsWith('../') && !rel.startsWith('..\\') && !isAbsolute(rel);
}
export async function dirs(path) {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    if (entries.some(e => e.isSymbolicLink())) throw new Error(`Symlink directory is not supported: ${path}`);
    return entries.filter(e => e.isDirectory() && !e.name.startsWith('.')).map(e => e.name).sort();
  } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}
export async function scanPlugins(root = ROOT) {
  const plugins = [];
  for (const category of await dirs(resolve(root, 'plugins'))) {
    if (!categories.some(c => c.id === category)) throw new Error(`Unknown plugin category: ${category}`);
    for (const slug of await dirs(resolve(root, 'plugins', category))) {
      const path = resolve(root, 'plugins', category, slug);
      plugins.push({ path, category, slug, manifest: await readJson(resolve(path, 'package.json')), meta: await readJson(resolve(path, 'plugin.meta.json')) });
    }
  }
  return plugins;
}
export async function validatePlugin(plugin) {
  const { path, category, slug, manifest: pkg, meta } = plugin;
  function requireThat(condition, message) { if (!condition) throw new Error(`${category}/${slug}: ${message}`); }
  requireThat(slugPattern.test(slug), 'invalid slug');
  requireThat(pkg.name === `dsh-${slug}`, 'package name must match directory slug');
  requireThat(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(pkg.version ?? ''), 'invalid version');
  requireThat(typeof pkg.description === 'string' && pkg.description.trim(), 'description required');
  requireThat(!/[|\r\n]/.test(pkg.description), 'description must be one line without table separators');
  requireThat(pkg.type === 'module', 'ESM package required');
  requireThat(typeof pkg.engines?.dsh === 'string' && pkg.engines.dsh.trim(), 'engines.dsh required');
  requireThat(semver.validRange(pkg.engines.dsh, { includePrerelease: true }), 'engines.dsh must be a SemVer range');
  requireThat(pkg.private === true || (typeof pkg.license === 'string' && pkg.license.trim()), 'publishable package needs a license');
  requireThat(meta.schemaVersion === 1 && meta.category === category, 'metadata version/category mismatch');
  requireThat(Array.isArray(meta.tags) && meta.tags.every(t => typeof t === 'string' && slugPattern.test(t)), 'tags must be slugs');
  for (const surface of ['web', 'desktop', 'headless']) {
    const item = meta.surfaces?.[surface];
    requireThat(['unverified', 'verified', 'unsupported'].includes(item?.status), `invalid ${surface} status`);
    requireThat(item.status !== 'verified' || (typeof item.evidence === 'string' && item.evidence.trim()), `${surface} verified needs evidence`);
  }
  requireThat(pkg.exports?.['.'] && Array.isArray(pkg.files), 'exports and files required');
  for (const command of ['check', 'build', 'test']) requireThat(typeof pkg.scripts?.[command] === 'string', `${command} script required`);
  const patchList = pkg.dsh?.bundle?.patch;
  const patches = typeof patchList === 'string' ? [patchList] : patchList;
  requireThat(Array.isArray(patches) && patches.length > 0, 'dsh.bundle.patch required');
  let selfMounted = false;
  for (const patch of patches) {
    requireThat(typeof patch === 'string' && !isAbsolute(patch) && inside(path, resolve(path, patch)), 'patch must stay in package');
    const entries = parse(await readFile(resolve(path, patch), 'utf8'));
    requireThat(Array.isArray(entries), 'patch must be an array');
    for (const entry of entries) for (const row of entry?.insert ?? []) {
      requireThat(typeof row.id === 'string' && row.id.startsWith(`${pkg.name}:`), 'insert IDs must use package namespace');
      if (row.name === pkg.name) selfMounted = true;
    }
  }
  requireThat(selfMounted, 'bundle must mount its package entry');
  const peers = pkg.peerDependencies ?? {};
  requireThat(typeof peers['@deepseek-ai/cordis'] === 'string', 'Cordis peer required');
  for (const [name, version] of Object.entries(peers)) {
    const developmentVersion = pkg.devDependencies?.[name];
    if (isDshPackage(name)) {
      requireThat(semver.valid(developmentVersion) && semver.satisfies(developmentVersion, version, { includePrerelease: true }),
        `${name} needs an exact dev version within its peer range`);
    } else {
      requireThat(developmentVersion === version, `${name} peer/dev versions must match`);
    }
  }
  if (pkg.dsh.client) {
    requireThat(pkg.dsh.client.platform === 'web' && pkg.exports['./client'], 'client manifest/export required');
  }
  for (const file of ['README.md', 'CHANGELOG.md', 'tsconfig.json', 'src/index.ts']) requireThat((await lstat(resolve(path, file))).isFile(), `${file} required`);
  return plugin;
}
export async function validatedPlugins(root = ROOT) {
  const plugins = await scanPlugins(root), names = new Set();
  for (const plugin of plugins) {
    await validatePlugin(plugin);
    if (names.has(plugin.manifest.name)) throw new Error(`Duplicate package: ${plugin.manifest.name}`);
    names.add(plugin.manifest.name);
  }
  return plugins;
}
