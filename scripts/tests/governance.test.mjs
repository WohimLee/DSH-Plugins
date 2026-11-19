import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPlugin } from '../create-plugin.mjs';
import { scanPlugins, validatedPlugins } from '../plugin-lib.mjs';
import { renderCatalog } from '../generate-catalog.mjs';

test('creation rejects traversal, unknown category, collisions and preserves existing content', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dshp-governance-'));
  try {
    await assert.rejects(createPlugin('host-tool', 'development', '../../escape', root));
    await assert.rejects(createPlugin('host-tool', 'unknown', 'example', root));
    const plugin = await createPlugin('host-tool', 'development', 'example', root);
    await writeFile(join(plugin, 'sentinel'), 'keep');
    await assert.rejects(createPlugin('host-tool', 'development', 'example', root));
    await assert.rejects(createPlugin('host-tool', 'ui', 'example', root));
    assert.equal(await readFile(join(plugin, 'sentinel'), 'utf8'), 'keep');
    const plugins = await validatedPlugins(root);
    assert.equal(plugins.length, 1);
    assert.match(renderCatalog(plugins), /dsh-example/);
    const metadata = plugins[0].meta;
    metadata.surfaces.desktop = { status: 'verified' };
    await writeFile(join(plugin, 'plugin.meta.json'), JSON.stringify(metadata));
    await assert.rejects(validatedPlugins(root), /needs evidence/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('packaged skill directory is renamed and escaping Bundle patches fail validation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dshp-governance-'));
  try {
    const path = await createPlugin('skill-bundle', 'knowledge', 'example-skill', root);
    assert.match(await readFile(join(path, 'skills/example-skill/SKILL.md'), 'utf8'), /name: example-skill/);
    assert.equal((await validatedPlugins(root)).length, 1);
    const [{ manifest }] = await scanPlugins(root);
    manifest.dsh.bundle.patch = '../../outside.yml';
    await writeFile(join(path, 'package.json'), JSON.stringify(manifest));
    await assert.rejects(validatedPlugins(root), /patch must stay/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a published DSH range may cover an exact development pin', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dshp-governance-'));
  try {
    const path = await createPlugin('host-tool', 'development', 'example', root);
    const [{ manifest }] = await scanPlugins(root);
    const peer = '@deepseek-ai/dsh-tools';
    const range = '>=0.2.2-rc.4 <0.2.3-0';
    manifest.engines.dsh = range;
    manifest.peerDependencies[peer] = range;
    manifest.devDependencies[peer] = '0.2.2-rc.5';
    const manifestPath = join(path, 'package.json');
    await writeFile(manifestPath, JSON.stringify(manifest));
    assert.equal((await validatedPlugins(root)).length, 1);
    manifest.devDependencies[peer] = range;
    await writeFile(manifestPath, JSON.stringify(manifest));
    await assert.rejects(validatedPlugins(root), /exact dev version within its peer range/);
    manifest.engines.dsh = 'workspace:*';
    await writeFile(manifestPath, JSON.stringify(manifest));
    await assert.rejects(validatedPlugins(root), /engines.dsh must be a SemVer range/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
