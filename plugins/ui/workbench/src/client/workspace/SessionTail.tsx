import type { ReactNode } from 'react';
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';

type Translator = PropsLocale<'workbench'>['t'];

function StatusMark({ running, unread, t }: { running: boolean; unread: boolean; t: Translator }) {
  if (running) return <svg role="img" className="wb-status-running" aria-label={t('running')} focusable="false"
    viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4">
    <circle cx="6" cy="6" r="5" opacity=".28" />
    <circle cx="6" cy="6" r="5" pathLength="1" strokeDasharray=".72 .28" strokeLinecap="round" />
  </svg>;
  return unread ? <span role="img" className="wb-status-unread" aria-label={t('unread')} /> : null;
}

function ScheduledMark({ t }: { t: Translator }) {
  const label = t('sessionScheduled');
  return <span role="img" className="wb-status-scheduled" aria-label={label} title={label}>
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
      <circle cx="8" cy="8" r="5.8" />
      <path d="M8 4.5V8l-1.9 1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  </span>;
}

export function SessionTail({ scheduled, running, unread, actions, t }: {
  scheduled: boolean; running: boolean; unread: boolean;
  actions?: { menu: ReactNode; pin?: ReactNode }; t: Translator;
}) {
  return <span className="wb-session-tail" data-actions={actions ? true : undefined}>
    {actions && <>
      <span data-wb-tail-slot="touch" aria-hidden="true" />
      <span data-wb-tail-slot="auxiliary" aria-hidden="true" />
    </>}
    <span data-wb-tail-slot="menu" aria-hidden="true" />
    <span data-wb-tail-slot="primary" aria-hidden="true" />
    {scheduled && !running && !unread
      ? <ScheduledMark t={t} />
      : <StatusMark running={running} unread={unread} t={t} />}
    {actions?.menu}{actions?.pin}
  </span>;
}
