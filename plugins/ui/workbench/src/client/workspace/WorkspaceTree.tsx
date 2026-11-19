import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import type { InjectFace, PropsLocale, PropsRenderFactories, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-api-session-controller/client';
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client';
import type {} from '@deepseek-ai/dsh-client-ui-session/client';
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client';
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots';
import type { TreeState } from './tree.js';
import { defaultSection, insert, moveProject, moveSession, placeSession, projectGroups, sessionGroups, ungrouped } from './tree.js';
import { useTreeDrag } from './drag.js';
import { DirectoryDialog } from './DirectoryDialog.js';
import { InlineName } from './InlineName.js';
import { RowMenu } from './RowMenu.js';
import type { MenuEntry, MenuTarget } from './RowMenu.js';
import type { Draft, Drafts } from './drafts.js';
import type { WorkspaceCommands } from './commands.js';

const visibleLimit = 10;
const rootSection = 'sections';
type SessionId = ReturnType<Context['sessions']['list']['getSnapshot']>['ids'][number];
type Actions = {
  updateTree: (change: (state: TreeState) => TreeState) => void;
  openSession: (session: SessionId) => void;
  commands: WorkspaceCommands;
  drafts: Drafts;
  setPinned: (session: SessionId, pin: boolean) => Promise<void>;
  hooks: { tree: HostObservable<TreeState>; draft: Drafts };
};
export type WorkspaceTreeProps = PropsRuntime<'sidebar.workspaces'> & PropsRenderFactories & PropsLocale<'workbench'> & InjectFace<Actions>;

type Icon = 'folderAdd' | 'project' | 'section' | 'add' | 'new' | 'pin' | 'more';
function Glyph({ icon }: { icon: Icon }) {
  const paths: Record<Icon, string> = {
    folderAdd: 'M2 6h7l2 2h11v11H2V6Zm10 5v5m-2.5-2.5h5',
    project: 'M2 6h7l2 2h11v11H2V6Z',
    section: 'm6 9 6 6 6-6',
    add: 'M12 5v14M5 12h14',
    new: 'M16 5H5v14h14V8m-4 6 6-6-3-3-6 6-1 4 4-1Z',
    pin: 'm10 3 11 11-5 1-4 4-2-5-5-2 4-4 1-5Zm0 11-6 6',
    more: 'M5 12h.01m6.99 0h.01m6.99 0h.01',
  };
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={icon === 'more' ? 3 : 1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={paths[icon]} />
  </svg>;
}
function Action({ label, icon, run, pinned, busy }: {
  label: string; icon: Icon; run?: (event: MouseEvent<HTMLButtonElement>) => void; pinned?: boolean; busy?: boolean;
}) {
  return <button type="button" className="wb-tree-action" title={label} aria-label={label}
    aria-disabled={!run || busy || undefined} aria-haspopup={icon === 'more' ? 'menu' : undefined} aria-pressed={pinned} data-pinned={pinned || undefined}
    onClick={busy ? undefined : run}><Glyph icon={icon} /></button>;
}

function ProjectChildren({ project, children, sessions, draft, showMoreLabel, depth }: {
  project: string; children: ReactNode; sessions: ReactNode[]; draft?: ReactNode; showMoreLabel: string; depth: number;
}) {
  const [showMore, setShowMore] = useState(false);
  return <div className="wb-tree-children" data-wb-project-children={project}>
    {children}
    {draft}
    {showMore ? sessions : sessions.slice(0, visibleLimit)}
    {!showMore && sessions.length > visibleLimit &&
      <button type="button" className="wb-tree-show-more" style={{ '--wb-depth': depth } as CSSProperties}
        onClick={() => setShowMore(true)}>{showMoreLabel}</button>}
  </div>;
}

function SessionItem({ session, selected, depth, pinned, busy, unread, dragProps, drop, open, toggle, menu, t, useSessionAccess }: {
  session: ReturnType<Context['sessions']['list']['getSnapshot']>['byId'][SessionId];
  selected: boolean; depth: number; pinned: boolean; busy: boolean; unread: boolean;
  dragProps: React.HTMLAttributes<HTMLDivElement>; drop?: string;
  open: () => void; toggle: () => void; menu: (event: MouseEvent) => void;
  t: WorkspaceTreeProps['t']; useSessionAccess: WorkspaceTreeProps['useSessionAccess'];
}) {
  const allowed = useSessionAccess(session.id, pinned ? 'workspace/unpinSession' : 'workspace/pinSession');
  return <div className="wb-tree-row" data-row-key={'session:' + session.id} data-wb-kind="session"
    onContextMenu={menu} data-selected={selected || undefined} data-drop={drop} style={{ '--wb-depth': depth } as CSSProperties} {...dragProps}>
    <button type="button" className="wb-tree-label" aria-current={selected ? 'true' : undefined}
      aria-label={session.blank && !session.title ? t('newSession') : session.displayTitle}
      title={session.blank && !session.title ? t('newSession') : session.displayTitle} onClick={open}>
      {session.running && <span className="wb-tree-running" aria-label={t('running')} />}
      {!session.running && unread && <span className="wb-tree-running" aria-label={t('unread')} />}
      <span>{session.blank && !session.title ? t('newSession') : session.displayTitle}</span>
    </button>
    <div className="wb-tree-actions">
      <Action label={t('sessionMenu')} icon="more" run={menu} />
      {allowed && <Action label={t(pinned ? 'unpinChat' : 'pinChat')} icon="pin" pinned={pinned} busy={busy} run={toggle} />}
    </div>
  </div>;
}

export function WorkspaceTree({ wide, expandSidebar, useSectionScroller, useTree, useSessions, useWorkspaces,
  usePanelInfo, useRemoteAccess, openSession, commands, drafts, useDraft, setPinned, useSessionAccess, updateTree, t }: WorkspaceTreeProps) {
  const tree = useTree(state => state);
  const draft = useDraft(value => value);
  const [menu, setMenu] = useState<MenuTarget>();
  const closeMenu = useCallback(() => setMenu(undefined), []);
  const [directory, setDirectory] = useState<{ initial?: string; confirm: (path: string) => Promise<void>; cancel?: () => void }>();
  const [rename, setRename] = useState<{ id: string; name: string; commit: (title: string) => void }>();
  const [projectChoice, setProjectChoice] = useState<{ draft: Draft; project?: WorkspaceId }>();
  const [creating, setCreating] = useState(false);
  const creatingRef = useRef(false);
  const sessions = useSessions(state => state);
  const workspaces = useWorkspaces(state => state);
  const onConversation = usePanelInfo(info => info.activePanelId === null);
  useEffect(() => { if (!onConversation) closeMenu(); }, [onConversation, closeMenu]);
  const canAdd = useRemoteAccess('workspace/create');
  const canCreateSession = useRemoteAccess('session/create');
  const { bindScrollerRef } = useSectionScroller();
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<'saveFailed' | 'pinFailed' | 'invalidMove' | 'actionFailed'>();
  const [pinning, setPinning] = useState<string>();
  const pinInFlight = useRef(false);
  const active = Object.values(sessions.byId).find(item => (item.retainedBy.mainView ?? 0) > 0)?.id;
  const archived = useMemo(() => new Set(workspaces.archivedSessionIds), [workspaces.archivedSessionIds]);
  const pins = useMemo(() => new Set<string>(workspaces.pinnedSessionIds), [workspaces.pinnedSessionIds]);
  const projects = useMemo(() => new Map(workspaces.items.map(item => [String(item.workspaceId), item])), [workspaces.items]);
  const projectIds = useMemo(() => [...projects.keys()], [projects]);
  const grouped = useMemo(() => projectGroups(tree, projectIds), [tree, projectIds]);
  const chatGroups = useMemo(() => sessionGroups(tree, workspaces.items.map(item => ({
    id: item.workspaceId, sessionIds: item.sessionIds,
  })), sessions.ids.map(id => sessions.byId[id]), pins), [tree, workspaces.items, sessions, pins]);

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
  const begin = (next: Draft) => {
    setRename(undefined);
    if (next.parent) show(next.parent);
    drafts.begin(next);
  };
  const titleDraft = (item: Draft, title: string) => {
    if (item.kind === 'section') {
      if (save(state => ({ ...state, sections: [{ id: 'section:' + crypto.randomUUID(), title }, ...state.sections] }))) drafts.end(item);
      return;
    }
    if (item.kind === 'project') {
      setDirectory({
        initial: projects.get(item.parent)?.path,
        cancel: () => drafts.end(item),
        confirm: async path => {
          const workspace = await commands.createProject(path);
          const id = workspace.workspaceId;
          const available = projects.has(id) ? projectIds : [...projectIds, id];
          const first = projectGroups(tree, available).get(item.parent)?.find(project => project !== id);
          const position = first ? { id: first, after: false } : undefined;
          if (moveProject(tree, id, item.parent, available, position) === tree) throw new Error('Invalid project parent');
          if (workspace.title !== title) await commands.renameProject(id, title);
          if (!save(state => moveProject(state, id, item.parent, available, position))) throw new Error('Could not persist project placement');
          drafts.end(item);
          setDirectory(undefined);
        },
      });
      return;
    }
    if (creatingRef.current) return;
    creatingRef.current = true;
    setCreating(true);
    const project = item.chooseProject ? (projectChoice?.draft === item ? projectChoice.project : undefined) : projects.get(item.parent)?.workspaceId;
    const parent = project ?? ungrouped;
    report(async () => {
      try {
        const { id, titled } = await commands.createSession(title, project);
        save(state => placeSession(state, id, parent, chatGroups.get(parent) ?? [], pins, undefined, true));
        show(parent);
        show(defaultSection);
        drafts.end(item);
        openSession(id);
        if (!titled) setError('actionFailed');
      } finally { creatingRef.current = false; setCreating(false); }
    });
  };
  const nameDraft = (item: Draft, depth = 0) => <InlineName key={item.kind + ':' + item.parent}
    label={t(item.kind === 'section' ? 'sectionName' : item.kind === 'project' ? 'projectName' : 'sessionName')}
    depth={depth} cancel={() => { if (!creatingRef.current && !directory) drafts.end(item); }}
    confirm={title => titleDraft(item, title)}
    controls={<>
      {item.chooseProject && <select aria-label={t('sessionProject')} defaultValue="" disabled={creating}
        onChange={event => setProjectChoice({ draft: item, project: projects.get(event.target.value)?.workspaceId })}>
        <option value="">{t('noProject')}</option>
        {workspaces.items.map(project => <option key={project.workspaceId} value={project.workspaceId}>{project.title}</option>)}
      </select>}
      <button type="submit" className="wb-control" disabled={creating}>{t('create')}</button>
    </>} />;
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

  const sessionMenu = (id: SessionId, parent: string) => {
    const session = sessions.byId[id];
    const destination = [{ id: ungrouped, label: t('ungrouped') },
      ...workspaces.items.map(project => ({ id: String(project.workspaceId), label: project.title }))];
    const setRead = () => save(state => ({ ...state,
      unread: state.unread?.includes(id) ? state.unread.filter(item => item !== id) : [...(state.unread ?? []), id] }));
    const entries: MenuEntry[] = [
      { label: t('rename'), run: () => setRename({ id, name: session.title ?? '', commit: title => report(async () => {
        await commands.renameSession(id, title); setRename(undefined);
      }) }) },
      { label: t('edit'), run: () => report(async () => {
        const initial = await commands.directory(id);
        setDirectory({ initial, confirm: async path => { await commands.setDirectory(id, path); setDirectory(undefined); } });
      }) },
      { label: t(pins.has(id) ? 'unpinChat' : 'pinChat'), run: () => { void togglePin(id); } },
      { label: t(tree.unread?.includes(id) ? 'markRead' : 'markUnread'), run: setRead },
      { label: t('moveChat'), children: destination.filter(item => item.id !== parent).map(item => ({ label: item.label, run: () => {
        save(state => moveSession(state, id, item.id, chatGroups.get(item.id) ?? [], pins)); show(item.id);
      } })) },
      { label: t('fork'), run: session.blank ? undefined : () => report(async () => {
        const child = await commands.forkSession(id);
        save(state => moveSession(state, child, parent, chatGroups.get(parent) ?? [], pins));
        openSession(child);
      }) },
      { label: t('share') },
      { label: t('copy'), children: [
        { label: t('copyTitle'), run: () => report(() => navigator.clipboard.writeText(session.displayTitle)) },
        { label: t('copyId'), run: () => report(() => navigator.clipboard.writeText(id)) },
      ] },
      { label: t('newWindow') },
      { label: t('archiveChat'), run: () => report(() => commands.archiveSession(id)) },
      { label: t('permanentDelete'), danger: true },
    ];
    return entries;
  };

  const rows = (project: string, depth: number) => (chatGroups.get(project) ?? [])
    .map(id => sessions.byId[id as SessionId])
    .filter(session => !archived.has(session.id) && (!session.blank || session.title || session.id === active))
    .map(session => <Fragment key={session.id}>
      {editingName(session.id, depth) ?? <SessionItem session={session} selected={session.id === active && onConversation}
        depth={depth} pinned={pins.has(session.id)} busy={pinning !== undefined} unread={tree.unread?.includes(session.id) ?? false}
        dragProps={drag.row({ kind: 'session', id: session.id, parent: project })}
        drop={drag.highlight?.id === session.id ? drag.highlight.placement : undefined}
        menu={event => openMenu(event, t('sessionMenu'), sessionMenu(session.id, project))}
        open={() => {
          if (tree.unread?.includes(session.id)) save(state => ({ ...state, unread: state.unread?.filter(id => id !== session.id) }));
          openSession(session.id);
        }}
        toggle={() => { void togglePin(session.id); }} t={t} useSessionAccess={useSessionAccess} />}
    </Fragment>);

  function projectMenu(project: (typeof workspaces.items)[number], id: string, parent: string): MenuEntry[] {
    const pinned = tree.projectPins?.includes(id);
    return [
      { label: t(pinned ? 'unpinProject' : 'pinProject'), run: () => save(state => ({ ...state,
        projectPins: pinned ? state.projectPins?.filter(item => item !== id) : [id, ...(state.projectPins ?? [])],
      })) },
      { label: t('edit'), run: () => setRename({ id, name: project.title, commit: title => report(async () => {
        await commands.renameProject(project.workspaceId, title); setRename(undefined);
      }) }) },
      { label: t('moveSection'), children: tree.sections.filter(section => section.id !== parent).map(section => ({
        label: section.title || t('projects'), run: () => {
          save(state => moveProject(state, id, section.id, projectIds)); show(section.id);
        },
      })) },
      { label: t('revealDirectory'), run: () => report(() => commands.reveal(project.path)) },
      { label: t('archiveChats'), run: () => {
        if (!window.confirm(t('archiveConfirm'))) return;
        report(async () => {
          const results = await Promise.allSettled((chatGroups.get(id) ?? []).filter(chat => !archived.has(chat as SessionId))
            .map(chat => commands.archiveSession(chat as SessionId)));
          if (results.some(result => result.status === 'rejected')) setError('actionFailed');
        });
      } },
      { label: t('removeProject'), danger: true, run: () => {
        if (window.confirm(t('removeProjectConfirm'))) report(() => commands.removeProject(project.workspaceId));
      } },
    ];
  }

  function projectRow(id: string, parent: string, depth: number): ReactNode {
    const project = projects.get(id);
    const label = project?.title || t('ungrouped');
    const expanded = !collapsed.has(id);
    const placement = drag.highlight?.id === id ? drag.highlight.placement : undefined;
    const showProjectMenu = project ? (event: MouseEvent) => openMenu(event, t('projectMenu'), projectMenu(project, id, parent)) : undefined;
    const sessionDraft = draft?.kind === 'session' && draft.parent === id;
    return <Fragment key={id}>
      {editingName(id, depth) ?? <div className="wb-tree-row" data-wb-kind="project" data-row-key={'project:' + id} data-drop={placement}
        onContextMenu={showProjectMenu} style={{ '--wb-depth': depth } as CSSProperties} {...drag.row({ kind: 'project', id, parent }, project !== undefined)}>
        <button type="button" className="wb-tree-label" aria-expanded={expanded} title={label} onClick={() => toggle(id)}>
          <Glyph icon="project" /><span>{label}</span>
        </button>
        {project && <div className="wb-tree-actions">
          <Action label={t('projectMenu')} icon="more" run={showProjectMenu} />
          {canAdd && <Action label={t('addSubproject')} icon="folderAdd" run={() => begin({ kind: 'project', parent: id })} />}
          {canCreateSession && <Action label={t('newSession')} icon="new" run={() => begin({ kind: 'session', parent: id })} />}
        </div>}
      </div>}
      {(expanded || sessionDraft) && <ProjectChildren project={id} depth={depth + 1} sessions={rows(id, depth + 1)} showMoreLabel={t('showMore')}
        draft={sessionDraft ? nameDraft(draft, depth + 1) : undefined}>
        {draft?.kind === 'project' && draft.parent === id && nameDraft(draft, depth + 1)}
        {(grouped.get(id) ?? []).map(child => projectRow(child, id, depth + 1))}
      </ProjectChildren>}
    </Fragment>;
  }

  if (!wide) return <button type="button" className="wb-tree-action wb-tree-compact"
    aria-label={t('projects')} title={t('projects')} onClick={expandSidebar}><Glyph icon="project" /></button>;

  return <div ref={bindScrollerRef} className="wb-tree" aria-label={t('projects')} data-workbench-tree>
    {error && <p role="status" className="wb-tree-error">{t(error)}</p>}
    {draft?.kind === 'section' && nameDraft(draft)}
    {tree.sections.map(section => {
      const expanded = !collapsed.has(section.id);
      const label = section.title || t('projects');
      const sectionActions: MenuEntry[] = [
        { label: t('rename'), run: () => setRename({ id: section.id, name: label, commit: title => {
          if (save(state => ({ ...state, sections: state.sections.map(item => item.id === section.id ? { ...item, title } : item) }))) setRename(undefined);
        } }) },
        { label: t('addProject'), run: canAdd ? () => begin({ kind: 'project', parent: section.id }) : undefined },
        { label: t('removeSection'), danger: true, run: section.id === defaultSection ? undefined : () => {
          if (window.confirm(t('removeSectionConfirm'))) save(state => ({ ...state, sections: state.sections.filter(item => item.id !== section.id) }));
        } },
      ];
      const showSectionMenu = (event: MouseEvent) => openMenu(event, t('sectionMenu'), sectionActions);
      const showUngrouped = section.id === defaultSection && (draft?.parent === ungrouped || rows(ungrouped, 1).length > 0);
      return <div className="wb-tree-section" key={section.id}>
        {editingName(section.id) ?? <div className="wb-tree-row" onContextMenu={showSectionMenu} data-wb-kind="section" data-row-key={section.id}
          data-drop={drag.highlight?.id === section.id ? drag.highlight.placement : undefined}
          {...drag.row({ kind: 'section', id: section.id, parent: rootSection })}>
          <button type="button" className="wb-tree-label" aria-expanded={expanded} onClick={() => toggle(section.id)}>
            <span>{label}</span><Glyph icon="section" />
          </button>
          <div className="wb-tree-actions">
            <Action label={t('sectionMenu')} icon="more" run={showSectionMenu} />
            {canAdd && <Action label={t('addProject')} icon="folderAdd" run={() => begin({ kind: 'project', parent: section.id })} />}
          </div>
        </div>}
        {expanded && draft?.kind === 'project' && draft.parent === section.id && nameDraft(draft)}
        {expanded && (grouped.get(section.id) ?? []).map(id => projectRow(id, section.id, 0))}
        {(expanded || draft?.parent === ungrouped) && showUngrouped && projectRow(ungrouped, section.id, 0)}
      </div>;
    })}
    <div className="wb-tree-tail" data-workbench-tree-end aria-hidden="true"
      data-drop={drag.highlight?.id === rootSection ? 'after' : undefined}
      {...drag.row({ kind: 'section', id: rootSection, parent: rootSection }, false, true)} />
    {menu && <RowMenu key={menu.x + ':' + menu.y + menu.label} target={menu} close={closeMenu}
      unavailable={t('actionUnavailable')} back={t('back')} />}
    {directory && <DirectoryDialog initial={directory.initial} list={commands.listDirectory} pick={commands.pickDirectory}
      t={t} cancel={() => { directory.cancel?.(); setDirectory(undefined); }} confirm={directory.confirm} />}
  </div>;
}
