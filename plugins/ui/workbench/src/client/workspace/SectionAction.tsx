import type { HocShare, InjectFace, PropsLocale, PropsRuntime, SlotMap } from '@deepseek-ai/dsh-client-ui-slots';

type SectionActionProps = PropsRuntime<'sidebar.session.action'> & HocShare<SlotMap['sidebar.session.action']> & PropsLocale<'workbench'> & InjectFace<{
  newSection: () => void;
  newSession: () => void;
  inline: boolean;
}>;

export function SectionAction({ children, wide, t, newSection, newSession, inline }: SectionActionProps) {
  if (!wide || !inline) return children;
  return <div className="wb-section-action">
    <div className="wb-section-session" onClickCapture={event => {
      if (!(event.target instanceof Element) || !event.target.closest('button')) return;
      event.preventDefault();
      event.stopPropagation();
      newSession();
    }}>{children}</div>
    <button type="button" className="wb-section-trigger wb-control" aria-label={t('addSection')} title={t('addSection')} onClick={newSection}>
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <path d="M3 6h18M3 12h8m5 2v8m-4-4h8" />
      </svg>
    </button>
  </div>;
}
