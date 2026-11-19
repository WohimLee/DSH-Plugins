import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { readCodex } from '../lib/codex.js';
import { AgentSync } from '../lib/index.js';

const config = { cwd: '', archived: false };
if (process.platform !== 'win32') test('Codex adapter paginates, scopes history, and preserves project roots and worktrees', async t => {
  const fixture = await mkdtemp(join(tmpdir(), 'agent-sync-fixture-'));
  t.after(() => rm(fixture, { recursive: true, force: true }));
  const command = join(fixture, 'codex');
  await copyFile(new URL('./fixtures/codex', import.meta.url), command);
  await chmod(command, 0o755);
  const originalPath = process.env.PATH;
  const originalFixture = process.env.AGENT_SYNC_FIXTURE;
  process.env.PATH = [fixture, originalPath].join(delimiter);
  t.after(() => {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    if (originalFixture === undefined) delete process.env.AGENT_SYNC_FIXTURE;
    else process.env.AGENT_SYNC_FIXTURE = originalFixture;
  });
  const signal = new AbortController().signal;
  const data = await readCodex(config, signal);
  assert.deepEqual(data.projects.map(project => project.name), ['Codex Project', 'Empty Codex Project']);
  assert.deepEqual(data.projects[0].roots, ['/codex/main']);
  assert.deepEqual(data.sessions.map(item => [item.title, item.cwd, item.projectId]), [
    ['Codex design review', '/codex/worktree/design', 'codex-project'], ['Codex unassigned', '/codex/standalone', null],
  ]);
  const filtered = await readCodex({ cwd: '/codex/worktree/design', archived: true }, signal);
  assert.deepEqual(filtered.sessions.map(item => item.archived), [false, true]);
  assert.deepEqual(filtered.projects.map(item => item.id), ['codex-project']);
  await assert.rejects(readCodex({ ...config, cwd: 'relative' }, signal), { code: 'invalidDirectory' });
  process.env.AGENT_SYNC_FIXTURE = 'legacy';
  const legacy = await readCodex(config, signal);
  assert.equal(legacy.projectsAvailable, false);
  assert.equal(legacy.sessions.length, 2);
  process.env.AGENT_SYNC_FIXTURE = 'hang';
  await assert.rejects(readCodex(config, AbortSignal.timeout(150)), { name: 'TimeoutError' });
});

test('remote methods reject non-owners and only allow previously synced IDs to open', async () => {
  const method = name => AgentSync.prototype[name];
  const guest = { ctx: { invocation: { peer: { principal: { kind: 'guest' } } } }, owner: method('owner') };
  const owner = { ctx: { invocation: { peer: { principal: { kind: 'owner' } } } }, owner: method('owner'),
    state: { snapshot: { sessions: [] } } };
  assert.throws(() => method('status').call(guest), { code: 'agent-sync/denied' });
  await assert.rejects(method('sync').call(guest, config, new AbortController().signal), { code: 'agent-sync/denied' });
  await assert.rejects(method('open').call(owner, '00000000-0000-7000-8000-000000000001'), { code: 'agent-sync/unknownThread' });
});
