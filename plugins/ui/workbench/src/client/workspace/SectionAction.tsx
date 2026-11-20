import type { HocShare, InjectFace, PropsLocale, PropsRuntime, SlotMap } from '@deepseek-ai/dsh-client-ui-slots';

type SectionActionProps = PropsRuntime<'sidebar.session.action'> & HocShare<SlotMap['sidebar.session.action']> & PropsLocale<'workbench'> & InjectFace<{
  newSection: () => void;
  inline: boolean; toggleActivity: () => void; activityOpen: boolean; pending: boolean;
}>;

export function SectionAction({ children, wide, t, newSection, inline, toggleActivity, activityOpen, pending }: SectionActionProps) {
  if (!wide || !inline) return children;
  return <div className="wb-section-action">
    <div className="wb-section-session">{children}</div>
    <button type="button" className="wb-section-trigger wb-control wb-bell" aria-label={t('viewActivity')}
      aria-pressed={activityOpen} title={t('viewActivity')} onClick={toggleActivity}>
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <path d="M5 10a7 7 0 0 1 14 0c0 5 2 6 2 8H3c0-2 2-3 2-8Zm4 11a4 4 0 0 0 6 0" />
      </svg>{pending && <span className="wb-status-unread" aria-label={t('unread')} />}
    </button>
    <button type="button" className="wb-section-trigger wb-control" aria-label={t('addSection')} title={t('addSection')} onClick={newSection}>
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <path d="M3 6h18M3 12h8m5 2v8m-4-4h8" />
      </svg>
    </button>
  </div>;
}
