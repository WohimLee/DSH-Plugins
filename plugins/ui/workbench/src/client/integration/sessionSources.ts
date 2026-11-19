import type { Context } from '@deepseek-ai/cordis';
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots';

export interface ExternalSession { id: string; title: string; cwd: string; projectId: string | null; updatedAt: number; archived: boolean }
export interface ExternalProject { id: string; name: string; roots: readonly string[] }
export interface ExternalSnapshot { syncedAt: number | null; projects: readonly ExternalProject[]; sessions: readonly ExternalSession[] }
interface AgentSyncSource extends HostObservable<ExternalSnapshot> { open(id: string): Promise<boolean> }

export interface SessionSources {
  selected: 'dsh' | 'codex';
  codex?: { snapshot: ExternalSnapshot; open(id: string): Promise<boolean> };
}

export function sessionSources(ctx: Context) {
  let state: SessionSources = { selected: 'dsh' };
  const listeners = new Set<() => void>();
  const publish = (next: SessionSources) => {
    state = next;
    for (const listener of listeners) listener();
  };
  ctx.inject(['agentSyncSessionsV1'], scope => {
    const source = Reflect.get(scope, 'agentSyncSessionsV1') as AgentSyncSource;
    const sync = () => {
      const snapshot = source.getSnapshot();
      if (snapshot.syncedAt === null) {
        if (state.codex) publish({ selected: 'dsh' });
      } else publish({ ...state, codex: { snapshot, open: id => source.open(id) } });
    };
    scope.effect(() => {
      const unsubscribe = source.subscribe(sync);
      sync();
      return () => { unsubscribe(); publish({ selected: 'dsh' }); };
    });
  });
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    select(next: SessionSources['selected']) {
      if (next === state.selected || (next === 'codex' && !state.codex)) return;
      publish({ ...state, selected: next });
    },
  };
}
