import { randomUUID } from 'node:crypto';
import { mkdir, rmdir } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-api-session-controller';
import type {} from '@deepseek-ai/dsh-working-directory';
import type {} from '@deepseek-ai/dsh-typert-registry';
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths';
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { contribution, service } from './remote.js';
import { deleteSession, finishSessionDeletions } from './delete-session.js';

export const name = 'dsh-workbench';
export const inject = ['typert', 'sessionController', 'workingDirectory', 'sessionPersistence', 'agents', 'sessions', 'workspaceRegistry'];
type SessionId = Parameters<Context['sessionController']['resolveAgent']>[0];

export class WorkbenchSessions extends TypertRemoteService {
  private readonly deleting = new Set<string>();
  constructor(ctx: Context) {
    super(ctx, service);
    ctx.effect(() => ctx.typert.register({ package: name, face: 'host', schemas: [],
      invocations: contribution.descriptors, model: { services: [], events: [], objects: [] } }));
  }

  private owner() {
    if (this.ctx.invocation?.peer.principal.kind !== 'owner') {
      throw new RemoteError('workbench/denied', 'Host owner required', undefined);
    }
  }

  private async agent(sessionId: string, signal: AbortSignal) {
    this.owner();
    signal.throwIfAborted();
    const result = await this.ctx.sessionController.resolveAgent(sessionId as SessionId);
    signal.throwIfAborted();
    if ('error' in result) throw new RemoteError('workbench/session-unavailable', 'Session unavailable', undefined);
    return result.agent;
  }

  @Remote
  async createStandalone(signal: AbortSignal): Promise<string> {
    this.owner();
    signal.throwIfAborted();
    const sessionId = randomUUID() as SessionId;
    const parent = join(resolveDshHome(), 'workspaces', 'standalone');
    await mkdir(parent, { recursive: true, mode: 0o700 });
    const cwd = join(parent, sessionId);
    await mkdir(cwd, { mode: 0o700 });
    try {
      signal.throwIfAborted();
      return (await this.ctx.sessionController.create({ sessionId, cwd })).sessionId;
    } catch (error) {
      // Only remove this newly created, empty directory.
      await rmdir(cwd).catch(() => {});
      throw error;
    }
  }

  @Remote
  async directory(sessionId: string, signal: AbortSignal): Promise<string> {
    const agent = await this.agent(sessionId, signal);
    return this.ctx.workingDirectory.get(agent.session);
  }

  @Remote
  async setDirectory(sessionId: string, path: string, signal: AbortSignal): Promise<string> {
    this.owner();
    if (!isAbsolute(path) || path.includes('\0')) {
      throw new RemoteError('workbench/invalid-directory', 'Expected an absolute host directory', undefined);
    }
    return this.ctx.workingDirectory.set(await this.agent(sessionId, signal), path, signal);
  }

  @Remote
  async deleteSession(sessionId: string, signal: AbortSignal): Promise<'deleted' | 'restart-required'> {
    this.owner();
    signal.throwIfAborted();
    if (this.deleting.has(sessionId)) throw new RemoteError('workbench/session-busy', 'Deletion is already running.', undefined);
    this.deleting.add(sessionId);
    try {
      return await deleteSession(this.ctx, sessionId as SessionId, signal);
    } catch (error) {
      if (error instanceof RemoteError || signal.aborted) throw error;
      if (error instanceof Error && error.name === 'SessionAlreadyOwnedError') {
        throw new RemoteError('workbench/session-busy', 'Another process has this session open.', undefined);
      }
      this.ctx.logger.warn('Workbench could not finish deleting a session: %s', error);
      throw new RemoteError('workbench/delete-failed', 'Could not finish deleting the session. Refresh and check its status.', undefined);
    } finally {
      this.deleting.delete(sessionId);
    }
  }
}

export async function apply(ctx: Context): Promise<void> {
  new WorkbenchSessions(ctx);
  const lifetime = new AbortController();
  ctx.effect(() => () => lifetime.abort());
  await finishSessionDeletions(ctx, lifetime.signal).catch(error => {
    if (!lifetime.signal.aborted) ctx.logger.warn('Workbench could not check pending deletions: %s', error);
  });
}
