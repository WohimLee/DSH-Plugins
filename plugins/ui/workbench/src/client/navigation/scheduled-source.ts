import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-api-remote-access/client';
import type {} from '@deepseek-ai/dsh-api-remotes/client';
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots';

type CatalogResult = Awaited<ReturnType<Context['remote']['schedule']['catalog']>>;
type Catalog = Extract<CatalogResult, { ok: true }>['value'];
export type ScheduledTask = Catalog[number];
export type ScheduledTasks = readonly ScheduledTask[];

export function activeScheduledSessionIds(tasks: ScheduledTasks): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const task of tasks) {
    if (task.status !== 'active') continue;
    for (const id of task.involvedSessionIds) ids.add(id);
    const target = task.target.kind === 'new' ? task.lastDelivery?.targetSessionId : task.target.sessionId;
    if (target) ids.add(target);
  }
  return ids;
}

/** Follow the authorized catalog while a Workbench view is subscribed. */
export function scheduledSource(ctx: Context): HostObservable<ScheduledTasks> {
  let snapshot: ScheduledTasks = [];
  let refresh: (() => void) | undefined;
  const listeners = new Set<() => void>();
  const publish = (tasks: ScheduledTasks) => {
    snapshot = tasks;
    for (const listener of listeners) listener();
  };

  ctx.inject(['remote.schedule'], scope => {
    scope.effect(() => scope.remoteAccess.whenAccess('schedule/catalog', () => {
      let request = 0;
      const read = async (): Promise<void> => {
        const generation = ++request;
        const result = await scope.remote.schedule.catalog().catch(() => undefined);
        if (readAuthorized === refresh && generation === request && result?.ok) publish(result.value);
      };
      const readAuthorized = () => { if (listeners.size > 0) void read(); };
      refresh = readAuthorized;
      const changed = scope.remote.$on('schedule/changed', readAuthorized);
      const reset = scope.on('connection/reset', () => { publish([]); readAuthorized(); });
      readAuthorized();
      return () => {
        refresh = undefined;
        changed();
        reset();
        publish([]);
      };
    }));
  });

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) refresh?.();
      return () => { listeners.delete(listener); };
    },
  };
}
