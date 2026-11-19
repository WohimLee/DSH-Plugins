import test from 'node:test';
import assert from 'node:assert/strict';
import { assertDshBaseline } from '../check-dsh-version.mjs';

const version = '0.2.2-rc.3';
const root = { devDependencies: { '@deepseek-ai/dsh': version, '@deepseek-ai/dsh-tools': version, '@deepseek-ai/cordis': '4.1.0' } };
const template = { engines: { dsh: version }, peerDependencies: { '@deepseek-ai/dsh-tools': version }, devDependencies: { '@deepseek-ai/dsh-tools': version } };

test('matching Desktop and manifests pass; CI can check consistency without Desktop', () => {
  assert.equal(assertDshBaseline(root, [['host-tool', template]], version), version);
  assert.equal(assertDshBaseline(root, [['host-tool', template]]), version);
});

test('explicit Desktop comparison detects a mismatched development baseline', () => {
  assert.throws(() => assertDshBaseline(root, [['host-tool', template]], '0.2.2-rc.4'), /Desktop.*differs/);
});

test('stale template engines, peer or development dependency are rejected', () => {
  for (const field of ['engines', 'peerDependencies', 'devDependencies']) {
    const stale = structuredClone(template);
    stale[field][field === 'engines' ? 'dsh' : '@deepseek-ai/dsh-tools'] = '0.2.2-rc.1';
    assert.throws(() => assertDshBaseline(root, [['host-tool', stale]], version), /host-tool:.*differs/);
  }
});

test('root DSH dependencies cannot drift or use a floating baseline', () => {
  const stale = structuredClone(root);
  stale.devDependencies['@deepseek-ai/dsh-tools'] = '0.2.2-rc.1';
  assert.throws(() => assertDshBaseline(stale, [], version), /root:.*differs/);
  stale.devDependencies['@deepseek-ai/dsh'] = 'latest';
  assert.throws(() => assertDshBaseline(stale, []), /exact version/);
});
