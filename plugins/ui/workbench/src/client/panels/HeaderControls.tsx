import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { changesKind, localChangesAddress, type ChangeCounts } from './changes.js';
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';

import { AgentIcon, useAgentCatalog, type Refresh } from './Subagents.js';
import type { SessionId } from '../workspace/commands.js';
import type { TreeStore } from '../workspace/store.js';
import { Glyph } from '../workspace/Glyph.js';

type HeaderProps = PropsRuntime<'conversation.session.header.utilities'> & PropsLocale<'workbench'> & InjectFace<{
  openResource: (address: string) => void;
  watchChanges: (id: SessionId, signal: AbortSignal, publish: (counts?: ChangeCounts) => void) => Promise<void>;
  refresh: Refresh; openAgents: () => void; openChat: (id: SessionId) => void; reveal: (path: string) => Promise<void>;
  hooks: { tree: TreeStore; nativeShare: HostObservable<boolean>; tabKinds: HostObservable<readonly string[]> };
}>;

export function HeaderControls({ sessionId, useSessions, useSessionStatus, useWorkspaces, useNativeShare, useTabKinds, useTree, openResource, openAgents, openChat, reveal, refresh, watchChanges, t }: HeaderProps) {
  const [open, setOpen] = useState(false);
  const [frame, setFrame] = useState<Element | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const panelId = useId();
  const [openFailed, setOpenFailed] = useState(false);
  const state = useSessions(value => value);
  const statuses = useSessionStatus(value => value);
  const { rows, failed } = useAgentCatalog(state, sessionId, statuses, refresh, open);
  const session = state.byId[sessionId];
  const project = useWorkspaces(state => state.items.find(project => project.sessionIds.includes(sessionId)));
  const savedFolders = useTree(tree => project && tree.sourceFolders?.[project.workspaceId]);
  const folders = savedFolders ?? (project ? [project.path] : []);
  const chats = state.ids.map(id => state.byId[id]).filter(chat => chat.parentId === sessionId && chat.origin !== 'subagent');
  const nativeShare = useNativeShare(value => value);
  const hasChanges = useTabKinds(kinds => kinds.includes(changesKind));

  const [counts, setCounts] = useState<ChangeCounts>();
  useEffect(() => {
    setCounts(undefined);
    if (!open || !hasChanges) return;
    const request = new AbortController();
    void watchChanges(sessionId, request.signal, next => { if (!request.signal.aborted) setCounts(next); })
      .catch(() => { if (!request.signal.aborted) setCounts(undefined); });
    return () => request.abort();
  }, [open, hasChanges, sessionId, watchChanges]);
  useEffect(() => { if (open) panel.current?.focus(); }, [open]);
  const active = rows.filter(row => row.group === 'active').length;
  const done = rows.filter(row => row.group === 'done').length;
  const progress = [active ? active + ' ' + t('active') : '', done + ' ' + t('done')].filter(Boolean).join(' · ');
  const toggleSummary = () => {
    setOpenFailed(false);
    setFrame(open ? null : trigger.current?.closest('[data-phase="active"]')?.querySelector('[data-workbench-summary-frame]') ?? null);
    setOpen(!open);
  };
  const summary = open && <section id={panelId} ref={panel} tabIndex={-1} className="wb-pinned-summary"
    aria-label={t('summary')} data-workbench-summary onKeyDown={event => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
        trigger.current?.focus();
      }
    }}>
    <h2>{project?.title ?? session?.displayTitle ?? t('summary')}</h2>
    <button type="button" className="wb-control wb-summary-row wb-summary-changes" disabled={!hasChanges}
      title={!hasChanges ? t('providerMissing') : undefined}
      onClick={() => { try { openResource(localChangesAddress(sessionId)); } catch { setOpenFailed(true); } }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <rect x="4" y="3" width="16" height="18" rx="3" /><path d="M8 9h8m-4-4v8m-4 4h8" />
      </svg>
      <span>{t('changes')}</span>{counts && <span className="wb-summary-value"><b>+{counts.added}</b> <em>−{counts.deleted}</em></span>}
    </button>
    {chats.length > 0 && <section><h3>{t('createdChats')}</h3>
      {chats.map(chat => <button type="button" className="wb-control wb-summary-row" key={chat.id}
        title={chat.displayTitle} onClick={() => openChat(chat.id)}>
        <Glyph icon="new" /><span>{chat.displayTitle}</span>
      </button>)}
    </section>}
    <section><button type="button" className="wb-control wb-summary-row" aria-label={t('agents')} onClick={() => {
      try { openAgents(); setOpen(false); } catch { setOpenFailed(true); }
    }}>
      <Glyph icon="list" /><span>{t('agents')}</span><span className="wb-summary-value">
        {rows.slice(0, 4).map(row => <AgentIcon key={row.id} id={row.id} />)}
        {failed.length ? t('retryCatalog') : progress || t('noActive')}
      </span>
    </button></section>
    {folders.length > 0 && <section><h3>{t('sources')}</h3>
      {folders.map(path => <button type="button" className="wb-control wb-summary-row" aria-label={path}
        title={path} key={path} onClick={() => { void reveal(path).catch(() => setOpenFailed(true)); }}>
        <Glyph icon="project" /><span>{path.split(/[\\/]/).filter(Boolean).at(-1) || path}</span>
      </button>)}
    </section>}
    {openFailed && <span role="status">{t('openFailed')}</span>}
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
