// The optional DSH Forge extension registers a resource-backed tab for local changes.
export const changesKind = 'forge-changes';

export function localChangesAddress(sessionId: string): string {
  return `dsh-resource://forge-changes/${encodeURIComponent(sessionId)}/local`;
}

// The optional Forge remote is mounted by its own client plugin.
export interface ForgePanel {
  follow(sessionId: string, signal: AbortSignal): AsyncIterable<{
    local: { files: readonly { additions: number; deletions: number }[] } | null;
  }> & { dispose(): void };
}
export type ChangeCounts = { added: number; deleted: number };

export async function observeCounts(panel: ForgePanel, sessionId: string, signal: AbortSignal, publish: (counts?: ChangeCounts) => void) {
  const stream = panel.follow(sessionId, signal);
  try {
    for await (const frame of stream) {
      if (signal.aborted) break;
      publish(frame.local?.files.reduce((counts, file) => ({
        added: counts.added + file.additions, deleted: counts.deleted + file.deletions,
      }), { added: 0, deleted: 0 }));
    }
  } finally { stream.dispose(); }
}
