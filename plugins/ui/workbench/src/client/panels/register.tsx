import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-api-remotes/client';
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client';
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client';
import type { HostObservable, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';
import { changesKind, forgeConnectionSource, localChangesAddress } from './changes.js';
import type { ScheduledTask, ScheduledTasks } from '../navigation/scheduled-source.js';
import { Guide } from './Guide.js';
import { HeaderControls } from './HeaderControls.js';

import { AgentRecord, SubagentsTab, agentsKind, type Refresh } from './Subagents.js';
import type { TreeStore } from '../workspace/store.js';
import type { SessionId, WorkspaceCommands } from '../workspace/commands.js';

const guideKey = '@deepseek-ai/dsh-client-ui-sidebar-right/guide';
const scheduleTaskKind = 'scheduleTask';
const scheduleTaskKey = '@deepseek-ai/dsh-client-ui-schedule/task';
function GuideTitle({ t }: PropsLocale<'workbench'>) { return <span>{t('newTab')}</span>; }

// Native ui-schedule exports this page at runtime; Workbench does not depend on loading that plugin.
declare module '@deepseek-ai/dsh-client-ui-sidebar-right/client' {
  interface SidebarRightTabParamsMap { scheduleTask: { sessionId: SessionId; id: ScheduledTask['id'] } }
}

export function registerRightPanels(ctx: Context, tree: TreeStore, commands: WorkspaceCommands, scheduledTasks: HostObservable<ScheduledTasks>): void {
  const registry = ctx.sidebarRightTabs;
  const refresh: Refresh = id => ctx.sessions.refreshProjections(id);
  ctx.effect(() => registry.register({ id: agentsKind, kind: agentsKind, title: () => ctx.locale.bind('workbench')('agents') }));
  const retain: Parameters<typeof SubagentsTab>[0]['retain'] = (parentSessionId, childSessionId, mode) =>
    ctx.sessions.retain({ parentSessionId, childSessionId, mode }, { source: 'workbenchRecord' });
  ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab', key: agentsKind, locale: 'workbench',
    children: { 'workbench.agent.record': { kind: 'single', scope: 'session' } },
    inject: () => ({ refresh, retain }),
  }, props => <SubagentsTab key={props.sessionId} {...props} />));
  ctx.slots.inject('workbench.agent.record', () => ctx.slots.register({ name: 'workbench.agent.record' }, AgentRecord));
  const forgeConnection = forgeConnectionSource(ctx);
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
  const nativeScheduleDetail = {
    getSnapshot: () => registry.get(scheduleTaskKind)?.id === scheduleTaskKey
      && ctx.slots.entriesOfSlot('sidebar.right.pane.tab').some(entry => entry.options.key === scheduleTaskKey),
    subscribe: (listener: () => void) => {
      const stopRegistry = registry.subscribe(listener);
      const stopSlot = ctx.slots.subscribe('sidebar.right.pane.tab', listener);
      return () => { stopRegistry(); stopSlot(); };
    },
  };
  const nativeShare = {
    getSnapshot: () => ctx.slots.entriesOfSlot(header).some(entry => entry.options.id === 'liveshare-share'),
    subscribe: (listener: () => void) => ctx.slots.subscribe(header, listener),
  };
  ctx.slots.inject('conversation.hero.frame', () => ctx.slots.register({
    name: 'conversation.hero.frame', id: 'dsh-workbench:summary-layout',
  }, ({ children, hero }) => hero ? children : <div data-workbench-summary-frame>{children}</div>));
  ctx.slots.inject(header, () => ctx.slots.register({
    name: header, id: 'dsh-workbench:header', order: -6, locale: 'workbench',
    inject: () => ({
      openChanges: (id: SessionId) => {
        if (ctx.sidebarRight.mounted.getSnapshot() === id) ctx.sidebarRight.openResource(localChangesAddress(id), { kind: changesKind });
      },
      refresh, openAgent: (id: SessionId) => ctx.sidebarRight.openTab(agentsKind, { params: { workbenchAgentId: id } }),
      openScheduledTask: (sessionId: SessionId, id: ScheduledTask['id']) => {
        if (ctx.sidebarRight.mounted.getSnapshot() === sessionId) ctx.sidebarRight.openTab(scheduleTaskKind, { params: { sessionId, id } });
      },
      openChat: ctx.uiWorkspace.openSession.bind(ctx.uiWorkspace), reveal: commands.reveal,
      hooks: { nativeShare, nativeScheduleDetail, tabKinds, tree, scheduledTasks, forgeConnection },
    }),
  }, HeaderControls));
}
