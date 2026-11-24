import { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Context } from '@deepseek-ai/cordis';
import type { HocShare, InjectFace, PropsLocale, PropsRuntime, SlotMap } from '@deepseek-ai/dsh-client-ui-slots';
import { Glyph } from './Glyph.js';
import { SessionSearch } from './SessionSearch.js';
import type { SessionId } from './commands.js';

type SectionActionProps = PropsRuntime<'sidebar.session.action'> & HocShare<SlotMap['sidebar.session.action']> & PropsLocale<'workbench'> & InjectFace<{
  newSection: () => void;
  search: Context['sessions']['search']; openSession: (id: SessionId) => void;
  inline: boolean; toggleActivity: () => void; activityOpen: boolean; pending: boolean;
}>;

export function SectionAction({ children, wide, t, newSection, inline, toggleActivity, activityOpen, pending,
  search, openSession, usePanelInfo, useSessions, useWorkspaces }: SectionActionProps) {
  const [header, setHeader] = useState<Element | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const sessions = useSessions(current => current);
  const workspaces = useWorkspaces(current => current);
  const findHeader = useCallback((node: HTMLDivElement | null) => {
    const brand = node?.closest('[data-slot="sidebar"]')?.querySelector('[data-slot="sidebar.brand.name"]');
    setHeader(brand?.closest('[data-window-drag]') ?? null);
  }, []);
  const home = usePanelInfo(info => info.activePanelId === null);
  if (!wide || !home || !inline) return children;

  const actions = <div className="wb-section-action">
    <button type="button" className="wb-section-trigger wb-control wb-bell" aria-label={t('viewActivity')}
      aria-pressed={activityOpen} title={t('viewActivity')} onClick={toggleActivity}>
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <path d="M5 10a7 7 0 0 1 14 0c0 5 2 6 2 8H3c0-2 2-3 2-8Zm4 11a4 4 0 0 0 6 0" />
      </svg>{pending && <span className="wb-status-unread" aria-label={t('unread')} />}
    </button>
    <button type="button" className="wb-section-trigger wb-control" aria-label={t('sessionSearch')} title={t('sessionSearch')}
      aria-haspopup="dialog" onClick={() => setSearchOpen(true)}>
      <Glyph icon="search" />
    </button>
  </div>;
  return <div className="wb-section-session" ref={findHeader}>
    <button type="button" className="wb-control wb-new-section" onClick={newSection}>
      <Glyph icon="circleAdd" />{t('addSection')}
    </button>
    {header ? createPortal(actions, header) : actions}
    {searchOpen && <SessionSearch t={t} sessions={sessions} workspaces={workspaces.items} archived={workspaces.archivedSessionIds}
      search={search} openSession={openSession} close={() => setSearchOpen(false)} />}
  </div>;
}
