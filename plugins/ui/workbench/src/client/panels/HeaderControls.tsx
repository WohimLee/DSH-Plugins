import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { changesKind, localChangesAddress, type ChangeCounts } from './changes.js';
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';

import { AgentIcon, useAgentCatalog, type Refresh } from './Subagents.js';
import type { SessionId } from '../workspace/commands.js';
import type { TreeStore } from '../workspace/store.js';
import { sessionGroups } from '../workspace/tree.js';
import { Glyph } from '../workspace/Glyph.js';

type HeaderProps = PropsRuntime<'conversation.session.header.utilities'> & PropsLocale<'workbench'> & InjectFace<{
  openResource: (address: string) => void;
  watchChanges: (id: SessionId, signal: AbortSignal, publish: (counts?: ChangeCounts, checkoutRoot?: string) => void) => Promise<void>;
  refresh: Refresh; openAgent: (id: SessionId) => void; openChat: (id: SessionId) => void; reveal: (path: string) => Promise<void>;
  hooks: { tree: TreeStore; nativeShare: HostObservable<boolean>; tabKinds: HostObservable<readonly string[]> };
}>;

function SummaryGroup({ kind, label, count, children, defaultOpen }: {
  kind: string; label: string; count?: number; children: ReactNode; defaultOpen?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultOpen ?? false);
  const itemsId = useId();
  return <div className="wb-summary-group" data-summary-group={kind}>
    <button type="button" className="wb-control wb-summary-heading" title={label}
      aria-expanded={expanded} aria-controls={itemsId} onClick={() => setExpanded(value => !value)}>
      <span>{label}</span>{count !== undefined && <small>· {count}</small>}
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <path d="m6 3 5 5-5 5" />
      </svg>
    </button>
    <div id={itemsId} className="wb-summary-items" hidden={!expanded}>{children}</div>
  </div>;
}

function directoryName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) || path;
}

function SummaryContents({ sessionId, useSessions, useSessionStatus, useWorkspaces, useTabKinds, useTree, openResource, openAgent, openChat, reveal, refresh, watchChanges, t }: HeaderProps) {
  const state = useSessions(value => value);
  const statuses = useSessionStatus(value => value);
  const { rows, failed } = useAgentCatalog(state, sessionId, statuses, refresh);
  const tree = useTree(value => value);
  const workspaces = useWorkspaces(value => value.items);
  const projects = workspaces.filter(project => project.workspaceId !== tree.ungroupedWorkspaceId);
  const session = state.byId[sessionId];
  const groups = sessionGroups(tree, projects.map(item => ({ id: item.workspaceId, sessionIds: item.sessionIds })),
    session ? [session] : [], new Set());
  const project = projects.find(item => groups.has(item.workspaceId));
  const savedFolders = project && tree.sourceFolders?.[project.workspaceId];
  const folders = project ? [...new Set([project.path, ...(savedFolders ?? [])])] : [];
  const chats = state.ids.map(id => state.byId[id]).filter(chat => chat.parentId === sessionId && chat.origin !== 'subagent' && !chat.blank);
  const hasChanges = useTabKinds(kinds => kinds.includes(changesKind));
  const [openFailed, setOpenFailed] = useState(false);
  const [changeSummary, setChangeSummary] = useState<{ counts?: ChangeCounts; checkoutRoot?: string }>();

  useEffect(() => {
    setChangeSummary(undefined);
    if (!hasChanges) return;
    const request = new AbortController();
    void watchChanges(sessionId, request.signal, (counts, checkoutRoot) => {
      if (!request.signal.aborted) setChangeSummary({ counts, checkoutRoot });
    }).catch(() => { if (!request.signal.aborted) setChangeSummary(undefined); });
    return () => request.abort();
  }, [hasChanges, sessionId, watchChanges]);

  const run = (action: () => void | Promise<void>) => {
    setOpenFailed(false);
    try { void Promise.resolve(action()).catch(() => setOpenFailed(true)); }
    catch { setOpenFailed(true); }
  };
  const hasAgents = rows.length > 0 || failed.length > 0;
  const { counts, checkoutRoot } = changeSummary ?? {};
  const separateCheckout = hasChanges && (!project || Boolean(checkoutRoot && checkoutRoot !== project.path));
  const changes = <button type="button" className="wb-control wb-summary-row wb-summary-changes" disabled={!hasChanges}
    title={hasChanges ? t('localChangesScope') : t('providerMissing')}
    onClick={() => run(() => openResource(localChangesAddress(sessionId)))}>
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <rect x="4" y="3" width="16" height="18" rx="3" /><path d="M8 9h8m-4-4v8m-4 4h8" />
    </svg>
    <span>{t('changes')}</span>{counts && <span className="wb-summary-value"><b>+{counts.added}</b> <em>−{counts.deleted}</em></span>}
  </button>;
  return <>
    {project && <SummaryGroup kind="project" label={project.title} defaultOpen>
      {!separateCheckout && changes}
      {folders.length > 0 && <div role="group" aria-label={t('summaryProjectFolders')}>
        <h3>{t('summaryProjectFolders')} · {folders.length}</h3>
        {folders.map(path => <button type="button" className="wb-control wb-summary-row" aria-label={path}
          title={path} key={path} onClick={() => run(() => reveal(path))}>
          <Glyph icon="project" /><span>{directoryName(path)}</span>
        </button>)}
      </div>}
    </SummaryGroup>}
    {separateCheckout && <SummaryGroup kind="checkout" label={checkoutRoot ? directoryName(checkoutRoot) : t('summaryCheckout')} defaultOpen>
      {changes}
    </SummaryGroup>}
    {chats.length > 0 && <SummaryGroup kind="chats" label={t('createdChats')} count={chats.length}>
      {chats.map(chat => <button type="button" className="wb-control wb-summary-row" key={chat.id}
        title={chat.displayTitle} onClick={() => run(() => openChat(chat.id))}>
        <Glyph icon="new" /><span>{chat.displayTitle}</span>
      </button>)}
    </SummaryGroup>}
    {hasAgents && <SummaryGroup kind="agents" label={t('agents')} count={rows.length || undefined}>
      {rows.map(row => <button type="button" className="wb-control wb-summary-row" key={row.id}
        title={row.title} disabled={row.mode === 'external'} onClick={() => run(() => openAgent(row.id))}>
        <AgentIcon id={row.id} /><span>{row.title}</span>
        <small>{row.mode === 'external' ? t('unavailableRecord') : t(row.group)}</small>
      </button>)}
      {failed.length > 0 && <button type="button" className="wb-control" onClick={() => {
        for (const id of failed) void refresh(id).catch(() => {});
      }}>{t('retryCatalog')}</button>}
    </SummaryGroup>}
    {!project && !hasChanges && !chats.length && !hasAgents && <p className="wb-summary-empty">{t('noItems')}</p>}
    {openFailed && <span role="status">{t('openFailed')}</span>}
  </>;
}

export function HeaderControls(props: HeaderProps) {
  const { sessionId, useNativeShare, openAgent, t } = props;
  const [open, setOpen] = useState(false);
  const [frame, setFrame] = useState<Element | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const panelId = useId();
  const nativeShare = useNativeShare(value => value);

  const closeSummary = () => {
    setOpen(false);
    setFrame(null);
  };
  useEffect(() => { if (open) panel.current?.focus(); }, [open]);
  const toggleSummary = () => {
    if (open) {
      closeSummary();
      return;
    }
    setFrame(trigger.current?.closest('[data-phase="active"]')?.querySelector('[data-workbench-summary-frame]') ?? null);
    setOpen(true);
  };
  const summary = open && <section id={panelId} ref={panel} tabIndex={-1} className="wb-pinned-summary"
    aria-label={t('summary')} data-workbench-summary onKeyDown={event => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        closeSummary();
        trigger.current?.focus();
      }
    }}>
    <SummaryContents key={sessionId} {...props} openAgent={id => { openAgent(id); closeSummary(); }} />
  </section>;
  return <div className="wb-header-controls">
    {!nativeShare && <span className="wb-share" tabIndex={0} title={t('shareUnavailable')}>
      <button type="button" className="wb-control" aria-label={t('share')} disabled>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <path d="M12 15V3m-4 4 4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
        </svg>
      </button>
    </span>}
    <button type="button" ref={trigger} className="wb-control" title={t('toggleSummary')} aria-label={t('toggleSummary')}
      aria-expanded={open} aria-controls={open ? panelId : undefined} onClick={toggleSummary}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <path d="M5 4h14a2 2 0 0 1 2 2v7H3V6a2 2 0 0 1 2-2ZM3 13v5a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5M7 8h10" />
      </svg>
    </button>
    {frame ? createPortal(summary, frame) : summary}
  </div>;
}
