import type { Context } from '@deepseek-ai/cordis';
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots';
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type {} from '@deepseek-ai/dsh-client-locale/client';

export interface PanelEntry { readonly id: MainPanelId; readonly label: string; readonly order: number }

/** Follow public navigation registrations, including locale and plugin changes. */
export function panelSource(ctx: Context): HostObservable<readonly PanelEntry[]> {
  let snapshot: readonly PanelEntry[] = [];
  const listeners = new Set<() => void>();
  const sync = () => {
    const next = ctx.slots.entriesOfSlot('sidebar.panellist').map(({ options }) => ({
      id: options.id as MainPanelId,
      label: typeof options.label === 'function' ? options.label() : options.label ?? options.id!,
      order: options.order ?? 0,
    })).sort((a, b) => a.order - b.order);
    if (snapshot.length === next.length && snapshot.every((entry, index) =>
      entry.id === next[index].id && entry.label === next[index].label && entry.order === next[index].order)) return;
    snapshot = next;
    listeners.forEach(listener => listener());
  };
  ctx.effect(() => ctx.slots.subscribe('sidebar.panellist', sync));
  ctx.effect(() => ctx.locale.subscribe(sync));
  ctx.effect(() => () => listeners.clear());
  sync();
  return { getSnapshot: () => snapshot, subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; } };
}
