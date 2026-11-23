import assert from 'node:assert/strict';
import test from 'node:test';
import { desktopPackages } from '../deliver.mjs';

function plugin(slug, dependencies = {}, status = 'verified') {
  return {
    category: 'ui',
    slug,
    meta: { surfaces: { desktop: { status } } },
    manifest: { name: `dsh-${slug}`, devDependencies: dependencies },
  };
}

const plugins = [
  plugin('workbench', { '@dsh-plugins/shared-ui': 'workspace:*' }),
  plugin('model-picker', { '@dsh-plugins/shared-icons': 'workspace:*' }),
  plugin('web-only', {}, 'unsupported'),
];
const shared = [
  {
    prefix: 'packages/shared-ui/',
    manifest: { name: '@dsh-plugins/shared-ui', dependencies: { '@dsh-plugins/shared-icons': 'workspace:*' } },
  },
  { prefix: 'packages/shared-icons/', manifest: { name: '@dsh-plugins/shared-icons' } },
];
const selected = paths => desktopPackages(paths, plugins, shared).map(item => item.slug);

test('Desktop delivery includes runtime changes and leaves documentation and tests out of the install', () => {
  assert.deepEqual(selected(['plugins/ui/workbench/locale/en.json', 'plugins/ui/model-picker/tests/host.mjs']), ['workbench']);
  assert.deepEqual(selected(['AGENTS.md', 'scripts/deliver.mjs', 'plugins/ui/workbench/README.md']), []);
  assert.deepEqual(selected(['plugins/ui/web-only/src/index.ts']), []);
});

test('Desktop delivery includes direct and transitive consumers of shared runtime changes', () => {
  assert.deepEqual(selected(['packages/shared-ui/src/index.ts']), ['workbench']);
  assert.deepEqual(selected(['packages/shared-icons/src/index.ts']), ['workbench', 'model-picker']);
  assert.deepEqual(selected(['pnpm-lock.yaml']), ['workbench', 'model-picker']);
});
