// The optional DSH Forge extension registers a resource-backed tab for local changes.
export const changesKind = 'forge-changes';

export function localChangesAddress(sessionId: string): string {
  return `dsh-resource://forge-changes/${encodeURIComponent(sessionId)}/local`;
}

// The optional Forge remote is mounted by its own client plugin.
export interface ForgePanel {
  follow(sessionId: string, signal: AbortSignal): AsyncIterable<{
    checkout?: { state: 'ready'; checkout: { root: string } } | { state: 'pending' | 'none' | 'failed' };
    local: { files: readonly { additions: number; deletions: number }[] } | null;
  }> & { dispose(): void };
}
export type ChangeCounts = { added: number; deleted: number };

export async function observeCounts(panel: ForgePanel, sessionId: string, signal: AbortSignal, publish: (counts?: ChangeCounts, checkoutRoot?: string) => void) {
  const stream = panel.follow(sessionId, signal);
  try {
    for await (const frame of stream) {
      if (signal.aborted) break;
      const counts = frame.local?.files.reduce((counts, file) => ({
        added: counts.added + file.additions, deleted: counts.deleted + file.deletions,
      }), { added: 0, deleted: 0 });
      publish(counts, frame.checkout?.state === 'ready' ? frame.checkout.checkout.root : undefined);
    }
  } finally { stream.dispose(); }
}
