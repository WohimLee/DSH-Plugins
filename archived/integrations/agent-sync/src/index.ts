import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-typert-registry';
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { readCodex, SyncError } from './codex.js';
import { contribution, emptySnapshot, service, threadId } from './remote.js';
import type { Config, Snapshot } from './remote.js';

export const name = 'dsh-agent-sync';
export const inject = ['typert'];
const execute = promisify(execFile);

declare module '@deepseek-ai/cordis' {
  interface Context { agentSync: AgentSync }
}

export class AgentSync extends TypertRemoteService {
  private state: { snapshot: Snapshot; active?: AbortController } = { snapshot: emptySnapshot };

  constructor(ctx: Context) {
    super(ctx, service);
    ctx.effect(() => {
      const dispose = ctx.typert.register({ package: name, face: 'host', schemas: [], invocations: contribution.descriptors,
        model: { services: [], events: [], objects: [] } });
      return async () => { this.clear(); await dispose(); };
    });
  }

  private owner(): void {
    if (this.ctx.invocation?.peer.principal.kind !== 'owner') throw new RemoteError('agent-sync/denied', 'Host owner required', undefined);
  }

  private clear(): void {
    this.state.active?.abort();
    this.state.active = undefined;
    this.state.snapshot = emptySnapshot;
  }

  @Remote
  status(): Snapshot { this.owner(); return this.state.snapshot; }

  @Remote
  async sync(options: Config, signal: AbortSignal): Promise<Snapshot> {
    this.owner();
    if (this.state.active) throw new RemoteError('agent-sync/busy', 'busy', undefined);
    const active = new AbortController();
    this.state.active = active;
    const lifetime = AbortSignal.any([signal, active.signal]);
    try {
      const result = await readCodex(options, lifetime);
      lifetime.throwIfAborted();
      this.state.snapshot = { ...result, config: options, syncedAt: Date.now() };
      return this.state.snapshot;
    } catch (error) {
      const code = lifetime.aborted ? 'cancelled' : error instanceof SyncError ? error.code : 'codexFailed';
      throw new RemoteError(`agent-sync/${code}`, code, undefined);
    } finally {
      if (this.state.active === active) this.state.active = undefined;
    }
  }

  @Remote
  disconnect(): Snapshot { this.owner(); this.clear(); return this.state.snapshot; }

  @Remote
  async open(id: string, signal: AbortSignal): Promise<boolean> {
    this.owner();
    if (!threadId.safeParse(id).success || !this.state.snapshot.sessions.some(item => item.id === id)) {
      throw new RemoteError('agent-sync/unknownThread', 'unknownThread', undefined);
    }
    if (process.platform !== 'darwin') throw new RemoteError('agent-sync/openUnavailable', 'openUnavailable', undefined);
    try {
      await execute('/usr/bin/open', [`codex://threads/${id}`], { signal, timeout: 5000 });
      return true;
    } catch {
      throw new RemoteError('agent-sync/openFailed', 'openFailed', undefined);
    }
  }
}

export function apply(ctx: Context): void { new AgentSync(ctx); }
