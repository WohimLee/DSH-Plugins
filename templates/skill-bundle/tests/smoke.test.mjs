import test from 'node:test';
import assert from 'node:assert/strict';
import * as plugin from '../lib/index.js';
test('bundled skill is available from the built package', async () => {
  let value;
  await plugin.apply({ skills: { register(skill) { value = skill; } } });
  assert.equal(value.name, '{{slug}}');
  assert.match(value.content, /示例技能/);
  assert.ok(value.resourceBase.path.endsWith('{{slug}}/'));
});
