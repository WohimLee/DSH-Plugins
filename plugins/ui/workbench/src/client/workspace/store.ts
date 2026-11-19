import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-api-session-controller/client';
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client';
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots';
import { emptyTree, placeSession, readTree, sessionGroups } from './tree.js';
import type { TreeState } from './tree.js';

const storageKey = 'dsh-workbench:workspace-tree:v1';

export interface TreeStore extends HostObservable<TreeState> {
  update(change: (state: TreeState) => TreeState): void;
  promote(sessionId: string): void;
}

function load(): TreeState {
  try { return readTree(JSON.parse(localStorage.getItem(storageKey) ?? 'null')); }
  catch { return emptyTree(); }
}

export function createTreeStore(ctx: Context): TreeStore {
  let state = load();
  let disposed = false;
  const listeners = new Set<() => void>();
  const publish = () => { for (const listener of listeners) listener(); };
  const store: TreeStore = {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    update(change) {
      if (disposed) return;
      const next = change(state);
      if (next === state) return;
      localStorage.setItem(storageKey, JSON.stringify(next));
      state = next;
      publish();
    },
    promote(sessionId) { promote([sessionId]); },
  };
  if (typeof window !== 'undefined') ctx.effect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key !== storageKey && event.key !== null) return;
      state = load();
      publish();
    };
    window.addEventListener('storage', sync);
    return () => { window.removeEventListener('storage', sync); };
  });

  const source = ctx.sessions.list;
  function promote(changed: readonly string[]) {
    const workspace = ctx.workspaces.list.getSnapshot();
    const sessions = source.getSnapshot();
    const projects = workspace.items.map(item => ({ id: item.workspaceId, sessionIds: item.sessionIds }));
    const rows = sessions.ids.map(id => sessions.byId[id]);
    const pins = new Set<string>(workspace.pinnedSessionIds);
    store.update(current => {
      for (const id of changed) {
        for (const [project, ids] of sessionGroups(current, projects, rows, pins)) {
          if (!ids.includes(id)) continue;
          if (ids.find(item => pins.has(item) === pins.has(id)) !== id) {
            current = placeSession(current, id, project, ids, pins, undefined, true);
          }
          break;
        }
      }
      return current;
    });
  }

  let previous = source.getSnapshot();
  ctx.effect(() => source.subscribe(() => {
    const snapshot = source.getSnapshot();
    // The host advances the list timestamp when it records a user message.
    // A newly loaded row is a baseline, not activity.
    const changed = snapshot.ids.filter(id => {
      const before = previous.byId[id]?.updatedAt;
      return before !== undefined && snapshot.byId[id].updatedAt > before;
    }).sort((a, b) => snapshot.byId[a].updatedAt - snapshot.byId[b].updatedAt);
    previous = snapshot;
    if (!changed.length) return;
    try {
      promote(changed);
    } catch (error) {
      console.warn('DSH Workbench could not save session order', error);
    }
  }));
  ctx.effect(() => () => {
    disposed = true;
    listeners.clear();
  });
  return store;
}
