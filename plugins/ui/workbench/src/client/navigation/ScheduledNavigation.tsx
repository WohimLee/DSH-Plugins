import { useLayoutEffect, useRef, useState } from 'react';
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';
import { Glyph } from '../workspace/Glyph.js';
import type {} from '../messages.js';
import type { ScheduledTask, ScheduledTasks } from './scheduled-source.js';
import {
  bindNativeSchedule, createNativeTask, nativeSchedulePage, openNativeTask, scheduledFrame, type NativeScheduleText,
} from './scheduled-native.js';

type Props = PropsLocale<'workbench'> & {
  useScheduledTasks<T>(selector: (tasks: ScheduledTasks) => T): T;
  nativeText: NativeScheduleText;
};

function recurrence(task: ScheduledTask): string {
  if (task.kind === 'after' || task.kind === 'at') return 'rule.once';
  if (task.kind === 'daily') return 'rule.daily';
  if (task.kind === 'weekly') return 'rule.weekly';
  if (task.kind !== 'rrule') return 'host.frequency.advanced';
  if (/(?:^RRULE:|;)COUNT=1(?:;|$)/m.test(task.rrule)) return 'rule.once';
  const frequency = /(?:^RRULE:|;)FREQ=([A-Z]+)/m.exec(task.rrule)?.[1];
  if (frequency === 'DAILY') return 'rule.daily';
  if (frequency === 'WEEKLY') return 'rule.weekly';
  if (frequency === 'MONTHLY') return 'host.frequency.monthly';
  return 'host.frequency.advanced';
}

function nextRun(task: ScheduledTask, locale: string): string {
  const next = new Date(task.scheduledAt);
  if (!Number.isFinite(next.getTime())) return '';
  const time = new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(next);
  if (task.status !== 'active') return time;
  const day = (date: Date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const days = (day(next) - day(new Date())) / 86_400_000;
  const date = days === 0 || days === 1
    ? new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(days, 'day')
    : new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(next);
  return `${date} ${time}`;
}

export function ScheduledNavigation({ useScheduledTasks, nativeText, t }: Props) {
  const title = t('scheduled');
  const active = t('active');
  const search = t('scheduledSearch');
  const tasks = useScheduledTasks(snapshot => snapshot);
  const navigation = useRef<HTMLElement>(null);
  const cancel = useRef<() => void>();
  const [selected, setSelected] = useState<string>();

  useLayoutEffect(() => {
    const frame = scheduledFrame(navigation.current);
    if (!frame) return;
    const unbind = bindNativeSchedule(frame, { title, active, search }, nativeText, setSelected);
    return () => { cancel.current?.(); unbind(); };
  }, [active, nativeText, search, title]);

  function act(action: (page: HTMLElement) => (() => void) | undefined) {
    cancel.current?.();
    const page = nativeSchedulePage(scheduledFrame(navigation.current));
    if (page) cancel.current = action(page);
  }

  const locale = nativeText('time.locale');
  const rows = (status: 'active' | 'paused') => tasks
    .filter(task => task.status === status)
    .sort((left, right) => left.scheduledAt.localeCompare(right.scheduledAt))
    .map(task => {
      const run = nextRun(task, locale);
      const timing = [run, nativeText(recurrence(task))].filter(Boolean).join(' · ');
      return <button type="button" key={task.id} className="wb-scheduled-row" data-workbench-scheduled-task={task.id}
        aria-current={selected === task.id ? 'true' : undefined} title={task.title}
        onClick={() => act(page => openNativeTask(page, task, nativeText))}>
        <span>{task.title}</span><small>{timing}</small>
      </button>;
    });
  const activeTasks = rows('active');
  const pausedTasks = rows('paused');

  return <nav ref={navigation} className="wb-scheduled-navigation" data-workbench-scheduled-navigation aria-label={title}>
    <div className="wb-scheduled-title">{title}</div>
    <button type="button" className="wb-scheduled-new" data-workbench-scheduled-new
      onClick={() => act(page => createNativeTask(page, nativeText))}><Glyph icon="add" />{t('scheduledNewTask')}</button>
    <div className="wb-scheduled-group" data-workbench-scheduled-group="active">
      <div className="wb-scheduled-group-title">{active}</div>
      {activeTasks}
    </div>
    <details className="wb-scheduled-paused" data-workbench-scheduled-paused>
      <summary>{nativeText('status.paused')}<Glyph icon="section" /></summary>
      {pausedTasks.length ? pausedTasks : <p>{nativeText('list.emptyPaused')}</p>}
    </details>
  </nav>;
}
