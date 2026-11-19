import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type {} from '@deepseek-ai/dsh-client-ui-layout/client';
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client';
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client';
import type {} from '@deepseek-ai/dsh-client-locale/client';
import { ActivityBar } from './navigation/ActivityBar.js';
import { SourcePicker } from './integration/SourcePicker.js';
import { sessionSources } from './integration/sessionSources.js';
import { ExternalTree } from './workspace/ExternalTree.js';
import { panelSource } from './integration/panels.js';
import { registerZoom } from './appearance/zoom.js';
import { installAppearance } from './appearance/install.js';
import { messages } from './messages.js';
import { registerRightPanels } from './panels/register.js';
import { contribution } from '../remote.js';
import { createDrafts } from './workspace/drafts.js';
import { workspaceCommands } from './workspace/commands.js';
import { SectionAction } from './workspace/SectionAction.js';
import { WorkspaceTree } from './workspace/WorkspaceTree.js';
import { createTreeStore } from './workspace/store.js';
import { registerWorkspaceView } from './workspace/view.js';

export const inject = ['slots', 'layout', 'uiWorkspace', 'locale', 'remoteAccess', 'sessions', 'workspaces', 'sidebarRight', 'sidebarRightTabs', 'remote', 'remote.workspaceFiles', 'remote.session', 'remote.directoryPicker'];

export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const unmount = await ctx.remote.$mount(contribution);
  try {
    const binding = ctx.inject(['remote.workbenchSessions'], assemble);
    return async () => { try { await binding.dispose(); } finally { await unmount(); } };
  } catch (error) {
    await unmount();
    throw error;
  }
}

function assemble(ctx: Context): void {
  const lifetime = new AbortController();
  ctx.effect(() => () => lifetime.abort());
  const drafts = createDrafts();
  const sources = sessionSources(ctx);
  ctx.effect(() => ctx.locale.register('workbench', messages));
  ctx.effect(() => installAppearance());
  const tree = createTreeStore(ctx);
  registerRightPanels(ctx, tree, workspaceCommands(ctx, lifetime.signal));
  registerZoom(ctx);
  const panels = panelSource(ctx);
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'dsh-workbench:activity', order: -100, locale: 'workbench',
    inject: () => ({
      selectPanel: ctx.layout.selectPanel.bind(ctx.layout),
      hooks: { panels },
    }),
  }, ActivityBar));
  const view = registerWorkspaceView(ctx, () => ctx.slots.register({
    name: 'sidebar.workspaces', priority: -100, locale: 'workbench',
    inject: () => ({
      updateTree: tree.update,
      openSession: ctx.uiWorkspace.openSession.bind(ctx.uiWorkspace),
      commands: workspaceCommands(ctx, lifetime.signal),
      drafts,
      async setPinned(id: Parameters<typeof ctx.workspaces.pinSession>[0], pin: boolean) {
        if (pin) await ctx.workspaces.pinSession(id);
        else await ctx.workspaces.unpinSession(id);
        tree.promote(id);
      },
      hooks: { tree, sources, draft: drafts },
    }),
  }, ({ useSources, ...props }) => {
    const state = useSources(current => current);
    return state.selected === 'codex' && state.codex ? <ExternalTree {...props} source={state.codex} /> : <WorkspaceTree {...props} />;
  }), () => sources.select('dsh'));
  ctx.slots.inject('sidebar.session.action', () => ctx.slots.register({
    name: 'sidebar.session.action', id: 'dsh-workbench:new-section', locale: 'workbench',
    inject: () => ({
      newSection: () => drafts.begin({ kind: 'section', parent: '' }), hooks: { sources, nativeView: view.native },
    }),
  }, ({ useSources, useNativeView, ...props }) => {
    const source = useSources(state => state.selected);
    const native = useNativeView(current => current);
    return source === 'dsh' ? <SectionAction {...props} inline={!native} /> : null;
  }));
  ctx.slots.inject('sidebar.brand.name', () => ctx.slots.register({
    name: 'sidebar.brand.name', priority: -100, locale: 'workbench',
    inject: () => ({ hooks: { sources }, select: (source: 'dsh' | 'codex') => {
      if (source === 'codex') view.showWorkbench();
      sources.select(source);
    } }),
  }, SourcePicker));
}
