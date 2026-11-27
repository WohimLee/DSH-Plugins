import type { Context } from '@deepseek-ai/cordis';
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots';

// The optional DSH Forge extension registers a resource-backed tab for local changes.
export const changesKind = 'forge-changes';

export function localChangesAddress(sessionId: string): string {
  return `dsh-resource://forge-changes/${encodeURIComponent(sessionId)}/local`;
}

// Only the fields used by Summary; the optional Forge client owns the full remote contract.
interface ForgePanel {
  follow(sessionId: string, signal: AbortSignal): AsyncIterable<{
    checkout: { state: 'ready'; checkout: { root: string } } | { state: 'pending' | 'none' | 'failed' };
    local: { files: readonly { additions: number; deletions: number }[] } | null;
  }> & { dispose(): void };
}
export type ForgeConnection = { readonly panel: ForgePanel };
export type LocalChanges = { root: string; counts?: { added: number; deleted: number } };

/** A new snapshot identity invalidates the old stream even if the remote object survives reconnection. */
export function forgeConnectionSource(ctx: Context): HostObservable<ForgeConnection | undefined> {
  let snapshot: ForgeConnection | undefined;
  const listeners = new Set<() => void>();
  const publish = (next: ForgeConnection | undefined) => {
    snapshot = next;
    for (const listener of listeners) listener();
  };
  ctx.inject(['remote.forgePanel'], scope => {
    const panel = scope.get('remote.forgePanel') as ForgePanel;
    scope.effect(() => {
      const stopReset = scope.on('connection/reset', () => publish({ panel }));
      publish({ panel });
      return () => { stopReset(); publish(undefined); };
    });
  });
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}

export async function observeLocalChanges({ panel }: ForgeConnection, sessionId: string, signal: AbortSignal,
  publish: (changes?: LocalChanges) => void) {
  if (signal.aborted) return;
  const stream = panel.follow(sessionId, signal);
  // Dispose promptly on cancellation, even while waiting for a frame.
  const dispose = () => stream.dispose();
  signal.addEventListener('abort', dispose, { once: true });
  try {
    for await (const frame of stream) {
      if (signal.aborted) return;
      const root = frame.checkout?.state === 'ready' ? frame.checkout.checkout.root : undefined;
      if (!root) { publish(undefined); continue; }
      const counts = frame.local?.files.reduce((counts, file) => ({
        added: counts.added + file.additions, deleted: counts.deleted + file.deletions,
      }), { added: 0, deleted: 0 });
      publish({ root, counts });
    }
  } finally {
    signal.removeEventListener('abort', dispose);
    if (!signal.aborted) dispose();
  }
}
