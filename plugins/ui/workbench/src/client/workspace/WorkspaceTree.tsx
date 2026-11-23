import { Glyph, type Icon } from './Glyph.js';
import { ActivityList, StatusMark } from './ActivityList.js';
import { ArchivedSection } from './ArchivedSection.js';
import { ProjectDialog } from './ProjectDialog.js';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import type { InjectFace, PropsLocale, PropsRenderFactories, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-api-session-controller/client';
import type {} from '@deepseek-ai/dsh-client-ui-session/client';
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client';
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots';
import type { Section, TreeState } from './tree.js';
import { defaultSection, insert, moveProject, moveSession, projectGroups, sessionGroups, ungrouped } from './tree.js';
import { useTreeDrag } from './drag.js';
import { DirectoryDialog } from './DirectoryDialog.js';
import { InlineName } from './InlineName.js';
import { RenameSessionDialog } from './RenameSessionDialog.js';
import { RemoveProjectDialog } from './RemoveProjectDialog.js';
import { RowMenu } from './RowMenu.js';
import type { MenuEntry, MenuTarget } from './RowMenu.js';
import type { Draft, Drafts } from './drafts.js';
import type { WorkspaceCommands } from './commands.js';

const visibleLimit = 10;
const rootSection = 'sections';
type SessionId = ReturnType<Context['sessions']['list']['getSnapshot']>['ids'][number];
type WorkspaceId = Parameters<WorkspaceCommands['removeProject']>[0];
type RemovalTarget = { id: string; title: string; workspaceId?: WorkspaceId };
type Actions = {
  updateTree: (change: (state: TreeState) => TreeState) => void;
  openSession: (session: SessionId) => void;
  commands: WorkspaceCommands;
  drafts: Drafts;
  setPinned: (session: SessionId, pin: boolean) => Promise<void>;
  hooks: { tree: HostObservable<TreeState>; draft: Drafts; activity: HostObservable<boolean> };
};
export type WorkspaceTreeProps = PropsRuntime<'sidebar.workspaces'> & PropsRenderFactories & PropsLocale<'workbench'> & InjectFace<Actions>;

function Action({ label, icon, run, pinned, busy }: {
  label: string; icon: Icon; run?: (event: MouseEvent<HTMLButtonElement>) => void; pinned?: boolean; busy?: boolean;
}) {
  return <button type="button" className="wb-tree-action" title={label} aria-label={label}
    aria-disabled={!run || busy || undefined} aria-haspopup={icon === 'more' ? 'menu' : undefined} aria-pressed={pinned} data-pinned={pinned || undefined}
    onClick={busy ? undefined : run}><Glyph icon={icon} /></button>;
}

function ProjectChildren({ project, children, sessions, showMoreLabel, depth }: {
  project: string; children?: ReactNode; sessions: ReactNode[]; showMoreLabel: string; depth: number;
}) {
  const [showMore, setShowMore] = useState(false);
  return <div className="wb-tree-children" data-wb-project-children={project}>
    {children}
    {showMore ? sessions : sessions.slice(0, visibleLimit)}
    {!showMore && sessions.length > visibleLimit &&
      <button type="button" className="wb-tree-show-more" style={{ '--wb-depth': depth } as CSSProperties}
        onClick={() => setShowMore(true)}>{showMoreLabel}</button>}
  </div>;
}

function SessionItem({ session, running, selected, depth, pinned, busy, unread, dragProps, drop, open, toggle, menu, t, useSessionAccess }: {
  session: ReturnType<Context['sessions']['list']['getSnapshot']>['byId'][SessionId];
  running: boolean; selected: boolean; depth: number; pinned: boolean; busy: boolean; unread: boolean;
  dragProps: React.HTMLAttributes<HTMLDivElement>; drop?: string;
  open: () => void; toggle: () => void; menu: (event: MouseEvent) => void;
  t: WorkspaceTreeProps['t']; useSessionAccess: WorkspaceTreeProps['useSessionAccess'];
}) {
  const allowed = useSessionAccess(session.id, pinned ? 'workspace/unpinSession' : 'workspace/pinSession');
  return <div className="wb-tree-row" data-row-key={'session:' + session.id} data-wb-kind="session"
    onContextMenu={menu} data-selected={selected || undefined} data-drop={drop} style={{ '--wb-depth': depth } as CSSProperties} {...dragProps}>
    <button type="button" className="wb-tree-label" aria-current={selected ? 'true' : undefined}
      aria-label={session.displayTitle} title={session.displayTitle} onClick={open}>
      <span>{session.displayTitle}</span>
    </button>
    <div className="wb-tree-actions">
      <Action label={t('sessionMenu')} icon="more" run={menu} />
      {allowed && <Action label={t(pinned ? 'unpinChat' : 'pinChat')} icon={pinned ? 'pinSolid' : 'pinOutline'} pinned={pinned} busy={busy} run={toggle} />}
    </div>
    <StatusMark running={running} unread={unread} t={t} />
  </div>;
}

export function WorkspaceTree({ wide, expandSidebar, useSectionScroller, useTree, useSessions, useWorkspaces,
  usePanelInfo, useActivity, useSessionStatus, useRemoteAccess, openSession, commands, drafts, useDraft, setPinned, useSessionAccess, updateTree, t }: WorkspaceTreeProps) {
  const tree = useTree(state => state);
  const activityOpen = useActivity(value => value);
  const statuses = useSessionStatus(value => value);
  const draft = useDraft(value => value);
  const [menu, setMenu] = useState<MenuTarget>();
  const closeMenu = useCallback(() => setMenu(undefined), []);
  const [directory, setDirectory] = useState<{ initial?: string; confirm: (path: string) => Promise<void> }>();
  const [createParent, setCreateParent] = useState<string>();
  const [rename, setRename] = useState<{ id: string; name: string; commit: (title: string) => void }>();
  const [editId, setEditId] = useState<string>();
  const [sessionRename, setSessionRename] = useState<{ id: SessionId; title: string }>();
  const [removal, setRemoval] = useState<RemovalTarget>();
  const sessions = useSessions(state => state);
  const workspaces = useWorkspaces(state => state);
  const onConversation = usePanelInfo(info => info.activePanelId === null);
  useEffect(() => { if (!onConversation) closeMenu(); }, [onConversation, closeMenu]);
  const canPickDirectory = useRemoteAccess('directoryPicker/pick');
  const canAdd = useRemoteAccess('workspace/create');
  const canCreateSession = useRemoteAccess('session/create');
  const canPrepareUngrouped = useRemoteAccess('workbenchSessions/prepareUngroupedDirectory');
  const canDeleteSession = useRemoteAccess('workbenchSessions/deleteSession');
  const canRemoveWorkspace = useRemoteAccess('workspace/delete');
  const { bindScrollerRef } = useSectionScroller();
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<'saveFailed' | 'pinFailed' | 'invalidMove' | 'actionFailed' | 'deleteFailed'>();
  const [deletePending, setDeletePending] = useState(false);
  const deleting = useRef(new Set<SessionId>());
  const recentsButton = useRef<HTMLButtonElement>(null);
  const [pinning, setPinning] = useState<string>();
  const pinInFlight = useRef(false);
  const active = Object.values(sessions.byId).find(item => (item.retainedBy.mainView ?? 0) > 0)?.id;
  const archived = useMemo(() => new Set(workspaces.archivedSessionIds), [workspaces.archivedSessionIds]);
  const pins = useMemo(() => new Set<string>(workspaces.pinnedSessionIds), [workspaces.pinnedSessionIds]);
  const backingWorkspace = workspaces.items.find(item => item.workspaceId === tree.ungroupedWorkspaceId);
  const canStartUngrouped = canCreateSession && (backingWorkspace !== undefined || canAdd && canPrepareUngrouped);
  const projects = useMemo(() => new Map(workspaces.items.filter(item => item.workspaceId !== tree.ungroupedWorkspaceId)
    .map(item => [String(item.workspaceId), item])), [workspaces.items, tree.ungroupedWorkspaceId]);
  const editingProject = editId ? projects.get(editId) : undefined;
  const projectIds = useMemo(() => [...projects.keys()], [projects]);
  const grouped = useMemo(() => projectGroups(tree, projectIds), [tree, projectIds]);
  const chatGroups = useMemo(() => sessionGroups(tree, [...projects.values()].map(item => ({
    id: item.workspaceId, sessionIds: item.sessionIds,
  })), sessions.ids.map(id => sessions.byId[id]), pins), [tree, projects, sessions, pins]);
  const latestGroups = useRef(chatGroups);
  const latestArchived = useRef(archived);
  latestGroups.current = chatGroups;
  latestArchived.current = archived;
  const sectionLabel = (section: Section) => section.id === defaultSection ? t('recents') : section.title || t('projects');

  const show = (id: string) => setCollapsed(previous => {
    if (!previous.has(id)) return previous;
    const next = new Set(previous);
    next.delete(id);
    return next;
  });
  const toggle = (id: string) => setCollapsed(previous => {
    const next = new Set(previous);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const save = (change: (current: TreeState) => TreeState) => {
    try { updateTree(change); setError(undefined); return true; }
    catch { setError('saveFailed'); return false; }
  };
  const report = (execute: () => Promise<unknown>) => {
    setError(undefined);
    void execute().catch(() => setError('actionFailed'));
  };
  const createProject = async (parent: string, title: string, [root, ...extraFolders]: string[]) => {
    if (workspaces.items.some(project => project.title === title)) return 'projectNameTaken' as const;
    const { workspace, created } = await commands.createProject(root);
    if (!created) return 'projectFolderTaken' as const;
    const id = workspace.workspaceId;
    const available = [...projectIds, id];
    try {
      if (workspace.title !== title) await commands.renameProject(id, title);
      updateTree(state => {
        const first = projectGroups(state, available).get(parent)?.find(project => project !== id);
        const next = moveProject(state, id, parent, available, first ? { id: first, after: false } : undefined);
        if (next === state) throw new Error('Invalid project parent');
        const paths = [workspace.path, ...extraFolders.filter(path => path !== workspace.path)];
        return { ...next, sourceFolders: { ...next.sourceFolders, [id]: paths } };
      });
    } catch (error) {
      // Undo only the registration created here, never the directory or its sessions.
      await commands.removeProject(id).catch(() => {});
      throw error;
    }
    show(parent);
  };
  const nameSection = (item: Draft) => <InlineName label={t('sectionName')} cancel={() => drafts.end(item)}
    confirm={title => {
      if (save(state => ({ ...state, sections: [{ id: 'section:' + crypto.randomUUID(), title }, ...state.sections] }))) drafts.end(item);
    }} controls={<button type="submit" className="wb-control">{t('create')}</button>} />;
  const editingName = (id: string, depth = 0) => rename?.id === id
    ? <InlineName label={t('rename')} depth={depth} initial={rename.name} cancel={() => setRename(undefined)} confirm={rename.commit} />
    : null;

  const openMenu = (event: MouseEvent, label: string, entries: readonly MenuEntry[]) => {
    event.preventDefault();
    const row = event.currentTarget.closest('.wb-tree-row');
    const restore = event.type === 'contextmenu' ? row?.querySelector<HTMLElement>('.wb-tree-label') : event.currentTarget;
    if (!(restore instanceof HTMLElement)) return;
    const bounds = restore.getBoundingClientRect();
    setMenu({ label, entries, x: event.type === 'contextmenu' && event.clientX ? event.clientX : bounds.left,
      y: event.type === 'contextmenu' && event.clientY ? event.clientY : bounds.bottom, restore });
  };

  const drag = useTreeDrag((source, target, placement) => {
    const inside = placement === 'inside';
    const parent = inside ? target.id : target.parent;
    const position = inside ? undefined : { id: target.id, after: placement === 'after' };
    if (source.kind === 'section') {
      save(current => {
        const byId = new Map(current.sections.map(section => [section.id, section]));
        return { ...current, sections: insert([...byId.keys()], source.id, position).map(id => byId.get(id)!) };
      });
      return;
    }
    if (source.kind === 'project') {
      const next = moveProject(tree, source.id, parent, projectIds, position);
      if (next === tree) { setError('invalidMove'); return; }
      save(current => moveProject(current, source.id, parent, projectIds, position));
    } else {
      const samePinGroup = !position || pins.has(source.id) === pins.has(position.id);
      if (!samePinGroup && parent === source.parent) return;
      save(current => moveSession(current, source.id, parent, chatGroups.get(parent) ?? [], pins,
        samePinGroup ? position : undefined));
    }
    if (inside) show(parent);
  });

  const togglePin = async (id: SessionId) => {
    if (pinInFlight.current) return;
    pinInFlight.current = true;
    setPinning(id);
    const pin = !pins.has(id);
    try {
      await setPinned(id, pin);
      setError(undefined);
    } catch { setError('pinFailed'); }
    finally {
      pinInFlight.current = false;
      setPinning(undefined);
    }
  };

  const forgetDeletedSessions = (ids: ReadonlySet<string>) => save(state => ({
    ...state,
    sessionProjects: Object.fromEntries(Object.entries(state.sessionProjects).filter(([id]) => !ids.has(id))),
    unread: state.unread?.filter(id => !ids.has(id)),
    sessions: Object.fromEntries(Object.entries(state.sessions).map(([project, group]) => [project, group.filter(id => !ids.has(id))])),
  }));
  const deleteEntry = (session: (typeof sessions.byId)[SessionId]): MenuEntry => ({
    label: t('permanentDelete'), danger: true,
    run: canDeleteSession && !(statuses.get(session.id)?.running ?? session.running) ? () => {
      const { id } = session;
      if (deleting.current.has(id) || !window.confirm(`${t('deleteConfirm')}\n\n${session.displayTitle}`)) return;
      deleting.current.add(id);
      setError(undefined);
      setDeletePending(false);
      void commands.deleteSession(id).then(result => {
        if (result === 'restart-required') { setDeletePending(true); return; }
        forgetDeletedSessions(new Set([id]));
      }).catch(() => setError('deleteFailed')).finally(() => deleting.current.delete(id));
    } : undefined,
  });

  const sessionMenu = (id: SessionId, parent: string) => {
    const session = sessions.byId[id];
    const destination = [{ id: ungrouped, label: t('ungrouped') },
      ...[...projects.values()].map(project => ({ id: String(project.workspaceId), label: project.title }))];
    const setRead = () => save(state => ({ ...state,
      unread: state.unread?.includes(id) ? state.unread.filter(item => item !== id) : [...(state.unread ?? []), id] }));
    const entries: MenuEntry[] = [
      { label: t('rename'), run: () => setSessionRename({ id, title: session.title ?? '' }) },
      { label: t('edit'), run: () => report(async () => {
        const initial = await commands.directory(id);
        setDirectory({ initial, confirm: async path => { await commands.setDirectory(id, path); setDirectory(undefined); } });
      }) },
      { label: t(pins.has(id) ? 'unpinChat' : 'pinChat'), run: () => { void togglePin(id); } },
      { label: t(tree.unread?.includes(id) ? 'markRead' : 'markUnread'), run: setRead },
      { label: t('moveChat'), children: destination.filter(item => item.id !== parent).map(item => ({ label: item.label, run: () => {
        save(state => moveSession(state, id, item.id, chatGroups.get(item.id) ?? [], pins)); show(item.id);
      } })) },
      { label: t('fork'), divider: true, run: session.blank ? undefined : () => report(async () => {
        const child = await commands.forkSession(id);
        save(state => moveSession(state, child, parent, chatGroups.get(parent) ?? [], pins));
        openSession(child);
      }) },
      { label: t('share'), divider: true },
      { label: t('copy'), children: [
        { label: t('copyTitle'), run: () => report(() => navigator.clipboard.writeText(session.displayTitle)) },
        { label: t('copyId'), run: () => report(() => navigator.clipboard.writeText(id)) },
      ] },
      { label: t('newWindow'), divider: true },
      { label: t('archiveChat'), divider: true, run: () => report(() => commands.archiveSession(id)) },
      deleteEntry(session),
    ];
    return entries;
  };

  const openChat = (id: SessionId) => {
    openSession(id);
    if (tree.unread?.includes(id)) save(state => ({ ...state, unread: state.unread?.filter(item => item !== id) }));
  };
  const rows = (project: string, depth: number) => (chatGroups.get(project) ?? [])
    .map(id => sessions.byId[id as SessionId])
    .filter(session => !archived.has(session.id) && (!session.blank || session.title))
    .map(session => <SessionItem key={session.id} session={session} selected={session.id === active && onConversation}
        running={statuses.get(session.id)?.running ?? session.running} depth={depth} pinned={pins.has(session.id)} busy={pinning !== undefined} unread={tree.unread?.includes(session.id) ?? false}
        dragProps={drag.row({ kind: 'session', id: session.id, parent: project })}
        drop={drag.highlight?.id === session.id ? drag.highlight.placement : undefined}
        menu={event => openMenu(event, t('sessionMenu'), sessionMenu(session.id, project))}
        open={() => openChat(session.id)}
        toggle={() => { void togglePin(session.id); }} t={t} useSessionAccess={useSessionAccess} />);

  async function removeProject(id: WorkspaceId) {
    await commands.removeProject(id);
    updateTree(state => {
      if (!state.sourceFolders?.[id]) return state;
      const sourceFolders = { ...state.sourceFolders };
      delete sourceFolders[id];
      return { ...state, sourceFolders };
    });
  }

  function removalSessions(target: RemovalTarget): SessionId[] {
    return (latestGroups.current.get(target.id) ?? []).map(id => id as SessionId)
      .filter(id => target.workspaceId !== undefined || !latestArchived.current.has(id));
  }

  async function removeWithSessions(target: RemovalTarget, confirmed: SessionId[]) {
    const approved = new Set(confirmed);
    const deleted = new Set<SessionId>();
    try {
      for (const id of confirmed) {
        if (!removalSessions(target).includes(id)) continue;
        const result = await commands.deleteSession(id);
        if (result === 'deleted') deleted.add(id);
        else {
          setDeletePending(true);
          if (!latestArchived.current.has(id)) await commands.archiveSession(id);
        }
      }
    } finally {
      if (deleted.size) forgetDeletedSessions(deleted);
    }
    if (removalSessions(target).some(id => !approved.has(id))) return 'removeChanged' as const;
    if (target.workspaceId !== undefined) await removeProject(target.workspaceId);
    else if (!save(state => ({ ...state, ungroupedInRecents: true }))) return 'removeFailed' as const;
    setEditId(undefined);
    return undefined;
  }

  function projectMenu(project: (typeof workspaces.items)[number], id: string, parent: string): MenuEntry[] {
    const pinned = tree.projectPins?.includes(id);
    return [
      { icon: 'pin', label: t(pinned ? 'unpinProject' : 'pinProject'), run: () => save(state => ({ ...state,
        projectPins: pinned ? state.projectPins?.filter(item => item !== id) : [id, ...(state.projectPins ?? [])],
      })) },
      { label: t('edit'), icon: 'edit', run: () => setEditId(id) },
      { label: t('moveSection'), icon: 'list', divider: true, children: tree.sections.filter(section => section.id !== parent).map(section => ({
        label: sectionLabel(section), run: () => {
          save(state => moveProject(state, id, section.id, projectIds)); show(section.id);
        },
      })) },
      { icon: 'project', label: t(/Mac/i.test(navigator.platform) ? 'revealFinder' : 'revealDirectory'), run: () => report(() => commands.reveal(project.path)) },
      { icon: 'archive', divider: true, label: t('archiveChats'), run: () => {
        if (!window.confirm(t('archiveConfirm'))) return;
        report(async () => {
          const results = await Promise.allSettled((chatGroups.get(id) ?? []).filter(chat => !archived.has(chat as SessionId))
            .map(chat => commands.archiveSession(chat as SessionId)));
          if (results.some(result => result.status === 'rejected')) setError('actionFailed');
        });
      } },
      { icon: 'close', divider: true, label: t('removeProject'), danger: true,
        run: () => setRemoval({ id, title: project.title, workspaceId: project.workspaceId }) },
    ];
  }

  const startUngrouped = () => {
    show(defaultSection);
    show(ungrouped);
    report(() => commands.startUngroupedSession(backingWorkspace?.workspaceId, workspaceId => {
      if (!save(state => ({ ...state, ungroupedWorkspaceId: workspaceId }))) throw new Error('Could not save the ungrouped workspace');
    }));
  };
  const removeUngrouped = () => setRemoval({ id: ungrouped, title: t('ungrouped') });
  const showUngroupedMenu = (event: MouseEvent) => openMenu(event, t('ungroupedMenu'), [
    { label: t('newSession'), icon: 'new', run: canStartUngrouped ? startUngrouped : undefined },
    { label: t('removeUngrouped'), icon: 'close', danger: true, run: removeUngrouped },
  ]);
  const showRecentsMenu = tree.ungroupedInRecents ? (event: MouseEvent) => openMenu(event, t('sectionMenu'), [
    { label: t('newUngrouped'), icon: 'new', run: canStartUngrouped ? startUngrouped : undefined },
    { label: t('restoreUngrouped'), icon: 'list', run: () => {
      if (save(state => ({ ...state, ungroupedInRecents: false }))) {
        show(defaultSection);
        show(ungrouped);
      }
    } },
    ...((chatGroups.get(ungrouped) ?? []).some(id => !archived.has(id as SessionId))
      ? [{ label: t('deleteUngrouped'), icon: 'close' as const, danger: true, run: removeUngrouped }] : []),
  ]) : undefined;

  function projectRow(id: string, parent: string, depth: number): ReactNode {
    const project = projects.get(id);
    const label = project?.title || t('ungrouped');
    const expanded = !collapsed.has(id);
    const placement = drag.highlight?.id === id ? drag.highlight.placement : undefined;
    const showProjectMenu = project ? (event: MouseEvent) => openMenu(event, t('projectMenu'), projectMenu(project, id, parent)) : showUngroupedMenu;
    return <Fragment key={id}>
      <div className="wb-tree-row" data-wb-kind="project" data-row-key={'project:' + id} data-drop={placement}
        onContextMenu={showProjectMenu} style={{ '--wb-depth': depth } as CSSProperties} {...drag.row({ kind: 'project', id, parent }, project !== undefined)}>
        <button type="button" className="wb-tree-label" aria-expanded={expanded} title={label} onClick={() => toggle(id)}>
          <Glyph icon="project" /><span>{label}</span>
        </button>
        <div className="wb-tree-actions">
          <Action label={t(project ? 'projectMenu' : 'ungroupedMenu')} icon="more" run={showProjectMenu} />
          {project && canAdd && <Action label={t('addSubproject')} icon="projectAdd" run={event => { event.currentTarget.focus(); setCreateParent(id); }} />}
          {(project ? canCreateSession : canStartUngrouped) && <Action label={t('newSession')} icon="new" run={project ? () => {
            show(id);
            commands.startSession(project.workspaceId);
          } : startUngrouped} />}
        </div>
      </div>
      {expanded && <ProjectChildren project={id} depth={depth + 1} sessions={rows(id, depth)} showMoreLabel={t('showMore')}>
        {(grouped.get(id) ?? []).map(child => projectRow(child, id, depth + 1))}
      </ProjectChildren>}
    </Fragment>;
  }

  if (!wide) return <button type="button" className="wb-tree-action wb-tree-compact"
    aria-label={t('projects')} title={t('projects')} onClick={expandSidebar}><Glyph icon="project" /></button>;

  const removalIds = removal ? removalSessions(removal) : [];
  const removalBlocked = sessions.phase !== 'ready' || workspaces.phase !== 'ready'
    || !!removal?.workspaceId && !canRemoveWorkspace || removalIds.length > 0 && !canDeleteSession;
  const removalBusy = removalIds.some(id => deleting.current.has(id) || (statuses.get(id)?.running ?? sessions.byId[id]?.running));
  const projectNames = new Map<string, string>();
  if (activityOpen) for (const [project, ids] of chatGroups) {
    for (const id of ids) projectNames.set(id, projects.get(project)?.title ?? t('ungrouped'));
  }
  return <>{activityOpen && <ActivityList sessions={sessions} statuses={statuses} archived={archived} unread={tree.unread ?? []}
    active={active} projects={projectNames} open={openChat} preview={commands.replyPreview} t={t} />}
    <div hidden={activityOpen} ref={bindScrollerRef} className="wb-tree" aria-label={t('projects')} data-workbench-tree>
    {error && <p role="status" className="wb-tree-error">{t(error)}</p>}
    {deletePending && <p role="status" className="wb-tree-error">{t('deletePending')}</p>}
    {draft && nameSection(draft)}
    {tree.sections.map(section => {
      const isDefault = section.id === defaultSection;
      const expanded = !collapsed.has(section.id);
      const label = sectionLabel(section);
      const showSectionMenu = isDefault ? showRecentsMenu : (event: MouseEvent) => openMenu(event, t('sectionMenu'), [
        { label: t('rename'), run: () => setRename({ id: section.id, name: label, commit: title => {
          if (save(state => ({ ...state, sections: state.sections.map(item => item.id === section.id ? { ...item, title } : item) }))) setRename(undefined);
        } }) },
        { label: t('addProject'), run: canAdd ? () => setCreateParent(section.id) : undefined },
        { label: t('removeSection'), danger: true, run: () => {
          if (window.confirm(t('removeSectionConfirm'))) save(state => ({ ...state, sections: state.sections.filter(item => item.id !== section.id) }));
        } },
      ]);
      const ungroupedRows = expanded && isDefault ? rows(ungrouped, 0) : [];
      return <Fragment key={section.id}><div className="wb-tree-section">
        {editingName(section.id) ?? <div className="wb-tree-row" onContextMenu={showSectionMenu} data-wb-kind="section" data-row-key={section.id}
          data-drop={drag.highlight?.id === section.id ? drag.highlight.placement : undefined}
          {...drag.row({ kind: 'section', id: section.id, parent: rootSection })}>
          <button type="button" className="wb-tree-label" aria-expanded={expanded} ref={isDefault ? recentsButton : undefined} onClick={() => toggle(section.id)}>
            <span>{label}</span><Glyph icon="section" />
          </button>
          <div className="wb-tree-actions">
            {showSectionMenu && <Action label={t('sectionMenu')} icon="more" run={showSectionMenu} />}
            {canAdd && <Action label={t('addProject')} icon="projectAdd"
               run={event => { event.currentTarget.focus(); setCreateParent(section.id); }} />}
            {isDefault && canCreateSession && <Action label={t('newSession')} icon="new"
              run={() => commands.startSession()} />}
          </div>
        </div>}
        {expanded && (grouped.get(section.id) ?? []).map(id => projectRow(id, section.id, 0))}
        {ungroupedRows.length > 0 && (tree.ungroupedInRecents
          ? <ProjectChildren project={ungrouped} depth={0} sessions={ungroupedRows} showMoreLabel={t('showMore')} />
          : projectRow(ungrouped, section.id, 0))}
      </div>
        {isDefault && <ArchivedSection t={t} useSessionAccess={useSessionAccess}
          sessions={sessions.ids.filter(id => archived.has(id)).map(id => sessions.byId[id])}
          menu={canDeleteSession ? (event, id) => openMenu(event, t('sessionMenu'), [deleteEntry(sessions.byId[id])]) : undefined}
          restore={async id => {
            setError(undefined);
            try { await commands.unarchiveSession(id); }
            catch { setError('actionFailed'); }
          }} />}
      </Fragment>;
    })}
    <div className="wb-tree-tail" data-workbench-tree-end aria-hidden="true"
      data-drop={drag.highlight?.id === rootSection ? 'after' : undefined}
      {...drag.row({ kind: 'section', id: rootSection, parent: rootSection }, false, true)} />
    {menu && <RowMenu key={menu.x + ':' + menu.y + menu.label} target={menu} close={closeMenu}
      unavailable={t('actionUnavailable')} back={t('back')} />}
    {directory && <DirectoryDialog initial={directory.initial} list={commands.listDirectory} pick={commands.pickDirectory}
      t={t} cancel={() => setDirectory(undefined)} confirm={directory.confirm} />}
    {createParent && <ProjectDialog key={createParent} mode="create" t={t} root={projects.get(createParent)?.path}
      canPickDirectory={canPickDirectory} commands={commands} close={() => setCreateParent(undefined)}
      save={(title, paths) => createProject(createParent, title, paths)} />}
    {editingProject && <ProjectDialog key={editId} mode="edit" t={t} initial={editingProject.title} root={editingProject.path}
      canPickDirectory={canPickDirectory} folders={tree.sourceFolders?.[editingProject.workspaceId] ?? [editingProject.path]} commands={commands}
      close={() => setEditId(undefined)}
      remove={() => setRemoval({ id: editingProject.workspaceId, title: editingProject.title, workspaceId: editingProject.workspaceId })}
      save={async (title, paths) => {
        const id = editingProject.workspaceId;
        const previous = tree.sourceFolders?.[id];
        const original = previous ?? [editingProject.path];
        const changed = paths.length !== original.length || paths.some((path, index) => path !== original[index]);
        if (changed) updateTree(state => ({ ...state, sourceFolders: { ...state.sourceFolders, [id]: paths } }));
        try {
          if (title !== editingProject.title) await commands.renameProject(id, title);
        } catch (error) {
          if (changed) updateTree(state => {
            if (state.sourceFolders?.[id] !== paths) return state;
            const sourceFolders = { ...state.sourceFolders };
            if (previous) sourceFolders[id] = previous;
            else delete sourceFolders[id];
            return { ...state, sourceFolders };
          });
          throw error;
        }
      }} />}
    {removal && <RemoveProjectDialog t={t} name={removal.title} project={removal.workspaceId !== undefined}
      count={removalIds.length} blocked={removalBlocked ? 'removeReady' : removalBusy ? 'removeBusy' : undefined}
      close={() => setRemoval(undefined)}
      remove={async () => {
        const result = await removeWithSessions(removal, removalIds);
        if (!result) requestAnimationFrame(() => recentsButton.current?.focus());
        return result;
      }} />}
    {sessionRename && <RenameSessionDialog key={sessionRename.id} initial={sessionRename.title} t={t}
      close={() => setSessionRename(undefined)} save={title => commands.renameSession(sessionRename.id, title)} />}
  </div></>;
}
