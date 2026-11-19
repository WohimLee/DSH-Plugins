import { useEffect, useState } from 'react';
import { changesKind, localChangesAddress, type ChangeCounts } from './changes.js';
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';

import { AgentIcon, useAgentCatalog, type Refresh } from './Subagents.js';
import type { SessionId } from '../workspace/commands.js';
import type { TreeStore } from '../workspace/store.js';

type HeaderProps = PropsRuntime<'conversation.session.header.utilities'> & PropsLocale<'workbench'> & InjectFace<{
  openResource: (address: string) => void;
  watchChanges: (id: SessionId, signal: AbortSignal, publish: (counts?: ChangeCounts) => void) => Promise<void>;
  refresh: Refresh; openAgents: () => void; openChat: (id: SessionId) => void; reveal: (path: string) => Promise<void>;
  hooks: { tree: TreeStore; nativeShare: HostObservable<boolean>; tabKinds: HostObservable<readonly string[]> };
}>;

export function HeaderControls({ sessionId, useSessions, useSessionStatus, useWorkspaces, useNativeShare, useTabKinds, useTree, openResource, openAgents, openChat, reveal, refresh, watchChanges, t }: HeaderProps) {
  const [pinned, setPinned] = useState(false);
  const [openFailed, setOpenFailed] = useState(false);
  const state = useSessions(value => value);
  const statuses = useSessionStatus(value => value);
  const { rows, failed } = useAgentCatalog(state, sessionId, statuses, refresh, pinned);
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
    if (!pinned || !hasChanges) return;
    const request = new AbortController();
    void watchChanges(sessionId, request.signal, next => { if (!request.signal.aborted) setCounts(next); })
      .catch(() => { if (!request.signal.aborted) setCounts(undefined); });
    return () => request.abort();
  }, [pinned, hasChanges, sessionId, watchChanges]);
  const active = rows.filter(row => row.group === 'active').length;
  const done = rows.filter(row => row.group === 'done').length;
  const progress = [active ? active + ' ' + t('active') : '', done + ' ' + t('done')].filter(Boolean).join(' · ');
  const toggleSummary = () => { setOpenFailed(false); setPinned(!pinned); };
  return <div className="wb-header-controls">
    {!nativeShare && <span className="wb-share" tabIndex={0} title={t('shareUnavailable')}>
      <button type="button" className="wb-control" aria-label={t('share')} disabled>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <path d="M12 15V3m-4 4 4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
        </svg>
      </button>
    </span>}
    <button type="button" className="wb-control" title={t('toggleSummary')} aria-label={t('toggleSummary')}
      aria-pressed={pinned} onClick={toggleSummary}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <path d="M5 4h14a2 2 0 0 1 2 2v7H3V6a2 2 0 0 1 2-2ZM3 13v5a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5M7 8h10" />
      </svg>
    </button>
    {pinned && <section className="wb-pinned-summary" aria-label={t('summary')} data-workbench-summary
      onKeyDown={event => { if (event.key === 'Escape') setPinned(false); }}>
      <strong>{project?.title ?? session?.displayTitle ?? t('summary')}</strong>
      <button type="button" className="wb-control wb-summary-changes" disabled={!hasChanges} title={!hasChanges ? t('providerMissing') : undefined}
        onClick={() => { try { openResource(localChangesAddress(sessionId)); } catch { setOpenFailed(true); } }}>{t('changes')}{counts && <span><b>+{counts.added}</b> <em>−{counts.deleted}</em></span>}</button>
      <section><small>{t('createdChats')}</small>
        {chats.length ? chats.map(chat => <button className="wb-control" key={chat.id} onClick={() => openChat(chat.id)}>{chat.displayTitle}</button>) : <span>{t('noItems')}</span>}</section>
      <section><button type="button" className="wb-control wb-summary-agents" aria-label={t('agents')} onClick={() => {
        try { openAgents(); setPinned(false); } catch { setOpenFailed(true); }
      }}><small>{t('agents')}</small><span>{rows.slice(0, 4).map(row => <AgentIcon key={row.id} id={row.id} />)}
        {failed.length ? t('retryCatalog') : progress}</span></button></section>
      <section><small>{t('sources')}</small>{folders.length ? folders.map(path =>
        <button className="wb-control" title={path} key={path} onClick={() => { void reveal(path).catch(() => setOpenFailed(true)); }}>{path}</button>) : <span>{t('noItems')}</span>}</section>
      {openFailed && <span role="status">{t('openFailed')}</span>}
    </section>}
  </div>;
}
