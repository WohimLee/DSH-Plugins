import { useState } from 'react';
import { changesKind, localChangesAddress } from './changes.js';
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';

type HeaderProps = PropsRuntime<'conversation.session.header.utilities'> & PropsLocale<'workbench'> & InjectFace<{
  openResource: (address: string) => void;
  hooks: { nativeShare: HostObservable<boolean>; tabKinds: HostObservable<readonly string[]> };
}>;

export function HeaderControls({ sessionId, useSessions, useWorkspaces, useNativeShare, useTabKinds, openResource, t }: HeaderProps) {
  const [pinned, setPinned] = useState(false);
  const [openFailed, setOpenFailed] = useState(false);
  const session = useSessions(state => state.byId[sessionId]);
  const project = useWorkspaces(state => state.items.find(project => project.sessionIds.includes(sessionId))?.title);
  const nativeShare = useNativeShare(value => value);
  const hasChanges = useTabKinds(kinds => kinds.includes(changesKind));

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
      <strong>{project ?? t('summary')}</strong>
      {session?.displayTitle && <div>{session.displayTitle}</div>}
      {session?.cwd && <div className="wb-summary-path" title={session.cwd}>{session.cwd}</div>}
      {session?.running && <div>{t('running')}</div>}
      {hasChanges && <button type="button" className="wb-control" onClick={() => {
        try { openResource(localChangesAddress(sessionId)); setOpenFailed(false); }
        catch { setOpenFailed(true); }
      }}>{t('changes')}</button>}
      {openFailed && <span role="status">{t('openFailed')}</span>}
    </section>}
  </div>;
}
