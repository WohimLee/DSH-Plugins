import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, rmdir, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-agent';
import type {} from '@deepseek-ai/dsh-session';
import type { SessionPersistence, SessionPersistenceSnapshot } from '@deepseek-ai/dsh-session-persistence';
import type {} from '@deepseek-ai/dsh-workspace';
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol';
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths';

type SessionId = Parameters<SessionPersistence['stat']>[0];
type Pending = { id: SessionId; directory: string };
const pendingRoot = () => join(resolveDshHome(), 'workbench', 'session-deletions');
const pendingName = (id: SessionId) => createHash('sha256').update(id).digest('hex') + '.json';

function sessionDirectory(snapshot: SessionPersistenceSnapshot | undefined, id: SessionId): string {
  const location = snapshot?.location;
  // Match the escaped Session directory name used by the rc.5 JSONL backend.
  const key = id === '.' || id === '..' ? id.replaceAll('.', '~002E')
    : id.replace(/[^A-Za-z0-9._-]/g, char => '~' + char.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0'));
  if (snapshot?.header.id !== id || location?.kind !== 'jsonl' || !isAbsolute(location.path)
    || basename(dirname(location.path)) !== key || !/^session\.v\d+\.jsonl(?:\.zstd)?$/.test(basename(location.path))) {
    throw new RemoteError('workbench/delete-unavailable', 'This session has no supported local JSONL archive.', undefined);
  }
  return dirname(location.path);
}

async function removeStored(ctx: Context, target: Pending, signal: AbortSignal): Promise<boolean> {
  const { id, directory: source } = target;
  const persistence = ctx.get('sessionPersistence');
  if (!persistence || ctx.get('sessions')?.get(id)) return false;
  const lease = await persistence.open(id, 'write', { signal }).catch((error: unknown) => {
    if (error instanceof Error && error.name === 'SessionAlreadyOwnedError') return undefined;
    throw error;
  });
  if (!lease) return false;
  let staging: string | undefined;
  try {
    const stored = await persistence.stat(id, { signal });
    if (sessionDirectory(stored, id) !== source || !stored?.location || !(await lstat(source)).isDirectory()
      || !(await lstat(stored.location.path)).isFile()) {
      throw new RemoteError('workbench/delete-unavailable', 'The stored session changed. Refresh and try again.', undefined);
    }
    signal.throwIfAborted();
    staging = await mkdtemp(join(dirname(source), '.workbench-delete-'));
    try {
      // The catalog scans only direct Session directories. Move all generations together.
      await rename(source, join(staging, 'session'));
    } catch (error) {
      await rmdir(staging).catch(() => undefined);
      staging = undefined;
      throw error;
    }
  } finally {
    try { await lease.close(); }
    finally { if (staging) await rm(staging, { recursive: true, maxRetries: 3 }); }
  }
  const registry = ctx.get('workspaceRegistry');
  if (registry) try {
    await registry.unpinSession(id);
    for (const workspace of registry.list()) {
      if (workspace.sessionIds.includes(id)) await workspace.detachSession(id);
    }
  } catch (error) {
    ctx.logger.warn('Workbench deleted a session but could not update its workspace metadata: %s', error);
  }
  ctx.emit('api-session/removed', id);
  return true;
}

export async function deleteSession(ctx: Context, id: SessionId, signal: AbortSignal): Promise<'deleted' | 'restart-required'> {
  const persistence = ctx.get('sessionPersistence');
  if (!persistence) throw new RemoteError('workbench/delete-unavailable', 'Local session storage is unavailable.', undefined);
  const activity = await ctx.waterfall('workspace/session-activity', { sessionId: id }, () => Promise.resolve([]));
  if (activity.length || ctx.get('agents')?.get(id)?.status === 'running') {
    throw new RemoteError('workbench/session-busy', 'Wait for this session to finish before deleting it.', undefined);
  }
  let stored = await persistence.stat(id, { signal });
  const live = ctx.sessions.get(id);
  if (live && !stored?.location) {
    await ctx.sessions.flush(live);
    stored = await persistence.stat(id, { signal });
  }
  const directory = sessionDirectory(stored, id);
  const target = { id, directory };
  if (await removeStored(ctx, target, signal)) return 'deleted';

  signal.throwIfAborted();
  const root = pendingRoot();
  await mkdir(root, { recursive: true, mode: 0o700 });
  const temp = join(root, `${randomUUID()}.tmp`);
  try {
    await writeFile(temp, JSON.stringify(target), { flag: 'wx', mode: 0o600 });
    signal.throwIfAborted();
    await rename(temp, join(root, pendingName(id)));
  } finally { await unlink(temp).catch(() => undefined); }
  return 'restart-required';
}

export async function finishSessionDeletions(ctx: Context, signal: AbortSignal): Promise<void> {
  const persistence = ctx.get('sessionPersistence');
  if (!persistence) return;
  const root = pendingRoot();
  const entries = await readdir(root, { withFileTypes: true }).catch((error: unknown) => {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  });
  for (const entry of entries) {
    signal.throwIfAborted();
    if (!entry.isFile() || !/^[a-f\d]{64}\.json$/.test(entry.name)) continue;
    const path = join(root, entry.name);
    try {
      const target = JSON.parse(await readFile(path, 'utf8')) as Pending | null;
      if (typeof target?.id !== 'string' || typeof target.directory !== 'string' || pendingName(target.id) !== entry.name) continue;
      const stored = await persistence.stat(target.id, { signal });
      if (!stored || (sessionDirectory(stored, target.id) === target.directory
        && await removeStored(ctx, target, signal))) await unlink(path);
    } catch (error) {
      ctx.logger.warn('Workbench could not complete a pending session deletion: %s', error);
    }
  }
}
