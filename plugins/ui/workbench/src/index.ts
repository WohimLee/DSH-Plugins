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

export const name = 'dsh-workbench';
export const inject = ['typert', 'sessionController', 'workingDirectory'];
type SessionId = Parameters<Context['sessionController']['resolveAgent']>[0];

export class WorkbenchSessions extends TypertRemoteService {
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
}

export function apply(ctx: Context): void { new WorkbenchSessions(ctx); }
