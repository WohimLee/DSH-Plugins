import test from 'node:test';
import assert from 'node:assert/strict';
import { activeRoute, groupProviders } from '../lib/client/model.js';
import { usage } from '../lib/remote.js';

test('provider groups preserve each configured billing route and the current selection', () => {
  const routes = ['deepseek-official', 'deepseek-account', 'codex', 'qoder-account-home', 'qoder-account-work']
    .map(id => ({ id, name: id, models: [{ id: 'auto', name: 'Auto' }] }));
  const groups = groupProviders(routes);
  assert.deepEqual(groups.map(group => group.id), ['deepseek', 'codex', 'qoder']);
  assert.equal(activeRoute(groups[0]).id, 'deepseek-account');
  assert.equal(activeRoute(groups[0], 'deepseek-official').id, 'deepseek-official');
  assert.equal(activeRoute(groups[2], 'qoder-account-work').id, 'qoder-account-work');
});

test('usage wire data rejects invalid percentages and omits provider-only payloads', () => {
  assert.equal(usage.safeParse({ windows: [{ remainingPercent: 101, minutes: 60 }] }).success, false);
  const quota = { credits: { plan: { remaining: 0, total: 100 } } };
  assert.deepEqual(usage.parse({ ...quota, privateData: 'omit' }), quota);
});
