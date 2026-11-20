import type { Context } from '@deepseek-ai/cordis';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';

export type SessionId = ReturnType<Context['sessions']['list']['getSnapshot']>['ids'][number];
type WorkspaceId = Parameters<Context['workspaces']['rename']>[0];

function value<T>(result: RemoteResult<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

export function workspaceCommands(ctx: Context, signal: AbortSignal) {
  // The local Desktop renderer exposes the same window-owned chooser used by DSH.
  const desktopPicker = (globalThis as typeof globalThis & {
    __DSH_DIRECTORY_PICKER__?: { pick(): Promise<string | null> };
  }).__DSH_DIRECTORY_PICKER__;
  const renameSession = async (id: SessionId, name: string) => {
    value(await ctx.remote.session.rename({ sessionId: id, title: name }));
    await ctx.sessions.refresh();
  };
  return {
    desktopPicker,
    async replyPreview(id: SessionId, request: AbortSignal): Promise<string> {
      const result = value(await ctx.remote.session.projections({ sessionId: id }, AbortSignal.any([signal, request])));
      const outline = result?.values.turnOutline;
      if (!Array.isArray(outline)) return '';
      for (let i = outline.length - 1; i >= 0; i--) {
        const turn = outline[i];
        if (turn && typeof turn === 'object' && 'response' in turn && typeof turn.response === 'string' && turn.response.trim()) {
          return turn.response;
        }
      }
      return '';
    },
    async listDirectory(path: string | undefined, request: AbortSignal) {
      const result = await ctx.remote.directoryPicker.list(path, AbortSignal.any([signal, request]));
      if (!result.ok && result.error.code === 'directory-picker/unavailable') {
        return { native: result.error.details.capability === 'native' };
      }
      return { listing: value(result), native: false };
    },
    async pickDirectory() { return value(await ctx.remote.directoryPicker.pick(signal)); },
    createProject: (path: string) => ctx.workspaces.create({ path }),
    renameProject: (id: WorkspaceId, title: string) => ctx.workspaces.rename(id, title),
    removeProject: (id: WorkspaceId) => ctx.workspaces.delete(id),
    async reveal(path: string) { value(await ctx.remote.session.openWorkspacePath({ path, action: 'reveal' }, signal)); },
    startSession: (project?: WorkspaceId) => ctx.uiWorkspace.startSession(project),
    renameSession,
    forkSession: (id: SessionId) => ctx.uiWorkspace.forkSession(id),
    unarchiveSession: (id: SessionId) => ctx.uiWorkspace.unarchiveSession(id),
    archiveSession: (id: SessionId) => ctx.uiWorkspace.archiveSession(id),
    async deleteSession(id: SessionId) {
      const result = value(await ctx.remote.workbenchSessions.deleteSession(id, signal));
      if (result === 'deleted') await ctx.sessions.refresh();
      return result;
    },
    async directory(id: SessionId) { return value(await ctx.remote.workbenchSessions.directory(id, signal)); },
    async setDirectory(id: SessionId, path: string) { value(await ctx.remote.workbenchSessions.setDirectory(id, path, signal)); },
  };
}
export type WorkspaceCommands = ReturnType<typeof workspaceCommands>;
