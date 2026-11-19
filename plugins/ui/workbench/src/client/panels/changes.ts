// The optional DSH Forge extension registers a resource-backed tab for local changes.
export const changesKind = 'forge-changes';

export function localChangesAddress(sessionId: string): string {
  return `dsh-resource://forge-changes/${encodeURIComponent(sessionId)}/local`;
}
