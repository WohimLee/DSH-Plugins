import test from 'node:test';
import assert from 'node:assert/strict';
import * as plugin from '../lib/index.js';
test('host carrier is side-effect free', () => {
  assert.doesNotThrow(() => plugin.apply());
});
