import { useEffect, useRef, useState } from 'react';
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client';
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client';
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';
import type { SessionId, WorkspaceCommands } from './commands.js';

type Translator = PropsLocale<'workbench'>['t'];
type Chat = SessionListState['byId'][SessionId];

export function StatusMark({ running, unread, t }: { running: boolean; unread: boolean; t: Translator }) {
  if (running) return <svg role="img" className="wb-status-running" aria-label={t('running')} focusable="false"
    viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4">
    <circle cx="6" cy="6" r="5" opacity=".28" />
    <circle cx="6" cy="6" r="5" pathLength="1" strokeDasharray=".72 .28" strokeLinecap="round" />
  </svg>;
  return unread ? <span role="img" className="wb-status-unread" aria-label={t('unread')} /> : null;
}

export function ScheduledMark({ t }: { t: Translator }) {
  const label = t('sessionScheduled');
  return <span role="img" className="wb-status-scheduled" aria-label={label} title={label}>
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
      <circle cx="8" cy="8" r="5.8" />
      <path d="M8 4.5V8l-1.9 1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  </span>;
}

function ActivityRow({ chat, project, running, unread, active, scheduled, preview, open, t }: {
  chat: Chat; project?: string; running: boolean; unread: boolean; active: boolean; scheduled: boolean;
  preview: WorkspaceCommands['replyPreview']; open: (id: SessionId) => void; t: Translator;
}) {
  const row = useRef<HTMLButtonElement>(null);
  const [text, setText] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      void preview(chat.id, controller.signal).then(result => {
        if (!controller.signal.aborted) setText(result);
      }).catch(() => {});
    });
    if (row.current) observer.observe(row.current);
    return () => { controller.abort(); observer.disconnect(); };
  }, [chat.id, chat.updatedAt, running, preview]);
  return <button ref={row} className="wb-activity-row" aria-current={active || undefined} onClick={() => open(chat.id)}>
    <span className="wb-activity-line"><span title={chat.displayTitle}>{chat.displayTitle}</span>
      <small title={project}>{project}</small>{scheduled && <ScheduledMark t={t} />}<StatusMark running={running} unread={unread} t={t} />
    </span>
    {text && <span className="wb-activity-preview">{text}</span>}
  </button>;
}

export function ActivityList({ sessions, statuses, archived, unread, active, projects, scheduledSessions, open, preview, t }: {
  sessions: SessionListState; statuses: SessionStatusSnapshot; archived: ReadonlySet<SessionId>;
  unread: readonly string[]; active?: SessionId; projects: ReadonlyMap<string, string>; scheduledSessions: ReadonlySet<string>;
  open: (id: SessionId) => void; preview: WorkspaceCommands['replyPreview']; t: Translator;
}) {
  const groups = new Map<string, Chat[]>();
  const priority: Chat[] = [];
  const today = new Date().toDateString();
  for (const chat of sessions.ids.map(id => sessions.byId[id]).sort((a, b) => b.updatedAt - a.updatedAt)) {
    if (archived.has(chat.id) || chat.origin === 'subagent' || (chat.blank && !chat.title)) continue;
    if (unread.includes(chat.id) || (statuses.get(chat.id)?.running ?? chat.running)) priority.push(chat);
    else {
      const date = new Date(chat.updatedAt);
      const label = date.toDateString() === today ? t('today') : date.toLocaleDateString();
      const rows = groups.get(label);
      if (rows) rows.push(chat);
      else groups.set(label, [chat]);
    }
  }
  const sections: [string, Chat[]][] = [...groups];
  if (priority.length) sections.unshift([t('priority'), priority]);
  return <div className="wb-tree" data-workbench-activity-list aria-label={t('viewActivity')}>
    {!sections.length && <p className="wb-tree-error">{t('noActivity')}</p>}
    {sections.map(([label, chats]) => <section key={label} className="wb-tree-section">
      <h3>{label}</h3>
      {chats.map(chat => <ActivityRow key={chat.id} chat={chat} project={projects.get(chat.id) ?? t('ungrouped')}
        running={statuses.get(chat.id)?.running ?? chat.running} unread={unread.includes(chat.id)}
        active={chat.id === active} scheduled={scheduledSessions.has(chat.id)} open={open} preview={preview} t={t} />)}
    </section>)}
  </div>;
}
