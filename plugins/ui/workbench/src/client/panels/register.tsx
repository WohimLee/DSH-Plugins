import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-api-remotes/client';
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client';
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client';
import type { HostObservable, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';
import { observeCounts, type ForgePanel } from './changes.js';
import { Guide } from './Guide.js';
import { HeaderControls } from './HeaderControls.js';

import { AgentRecord, SubagentsTab, agentsKind, type Refresh } from './Subagents.js';
import type { TreeStore } from '../workspace/store.js';
import type { WorkspaceCommands } from '../workspace/commands.js';

const guideKey = '@deepseek-ai/dsh-client-ui-sidebar-right/guide';
function GuideTitle({ t }: PropsLocale<'workbench'>) { return <span>{t('newTab')}</span>; }

export function registerRightPanels(ctx: Context, tree: TreeStore, commands: WorkspaceCommands): void {
  const registry = ctx.sidebarRightTabs;
  const refresh: Refresh = id => ctx.sessions.refreshProjections(id);
  ctx.effect(() => registry.register({ id: agentsKind, kind: agentsKind, title: () => ctx.locale.bind('workbench')('agents') }));
  const retain: Parameters<typeof SubagentsTab>[0]['retain'] = (parentSessionId, childSessionId, mode) =>
    ctx.sessions.retain({ parentSessionId, childSessionId, mode }, { source: 'workbenchRecord' });
  ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab', key: agentsKind, locale: 'workbench',
    children: { 'workbench.agent.record': { kind: 'single', scope: 'session' } },
    inject: () => ({ refresh, retain }),
  }, props => <SubagentsTab {...props} />));
  ctx.slots.inject('workbench.agent.record', () => ctx.slots.register({ name: 'workbench.agent.record' }, AgentRecord));
  const watchChanges: Parameters<typeof HeaderControls>[0]['watchChanges'] = async (id, signal, publish) => {
    const panel = ctx.get('remote.forgePanel') as ForgePanel | undefined;
    if (panel) await observeCounts(panel, id, signal, publish);
  };
  let definitions = registry.entries();
  let kinds = definitions.map(definition => definition.kind);
  const tabKinds: HostObservable<readonly string[]> = {
    getSnapshot: () => {
      const next = registry.entries();
      if (next !== definitions) { definitions = next; kinds = next.map(definition => definition.kind); }
      return kinds;
    },
    subscribe: listener => registry.subscribe(listener),
  };
  const guideEntries = { getSnapshot: () => registry.guide(), subscribe: (listener: () => void) => registry.subscribe(listener) };
  ctx.slots.inject('sidebar.right.tab.guide', () => ctx.slots.register({
    name: 'sidebar.right.tab.guide', priority: -100, select: () => true, locale: 'workbench',
    inject: () => ({ search: (...args: Parameters<typeof ctx.remote.workspaceFiles.search>) => ctx.remote.workspaceFiles.search(...args),
      hooks: { guideEntries, tabKinds } }),
  }, Guide));
  ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab.title', key: guideKey, priority: -100, locale: 'workbench',
  }, GuideTitle));
  const header = 'conversation.session.header.utilities';
  const nativeShare = {
    getSnapshot: () => ctx.slots.entriesOfSlot(header).some(entry => entry.options.id === 'liveshare-share'),
    subscribe: (listener: () => void) => ctx.slots.subscribe(header, listener),
  };
  ctx.slots.inject(header, () => ctx.slots.register({
    name: header, id: 'dsh-workbench:header', order: -6, locale: 'workbench',
    inject: () => ({ openResource: (address: string) => ctx.sidebarRight.openResource(address), refresh, openAgents: () => ctx.sidebarRight.openTab(agentsKind),
      openChat: ctx.uiWorkspace.openSession.bind(ctx.uiWorkspace), reveal: commands.reveal, watchChanges, hooks: { nativeShare, tabKinds, tree } }),
  }, HeaderControls));
}
