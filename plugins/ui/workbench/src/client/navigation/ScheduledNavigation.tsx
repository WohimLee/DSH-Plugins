import { useCallback, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import type { GlobalStandardProps, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';
import { RowMenu, type MenuEntry, type MenuTarget } from '../workspace/RowMenu.js';
import type { scheduleAction, ScheduledAction, ScheduledActionFailure } from './scheduled-actions.js';
import { Glyph } from '../workspace/Glyph.js';
import { SidebarNotice } from '../workspace/SidebarNotice.js';
import type {} from '../messages.js';
import type { ScheduledTask, ScheduledTasks } from './scheduled-source.js';
import {
  bindNativeSchedule, createNativeTask, nativeSchedulePage, openNativeTask, scheduledFrame, type NativeScheduleText,
} from './scheduled-native.js';

type Props = PropsLocale<'workbench'> & Pick<GlobalStandardProps, 'useRemoteAccess'> & {
  useScheduledTasks<T>(selector: (tasks: ScheduledTasks) => T): T;
  nativeText: NativeScheduleText;
  scheduleAction: ReturnType<typeof scheduleAction>;
};

type TaskMenu = Omit<MenuTarget, 'entries'> & { taskId: ScheduledTask['id'] };

function DeleteTaskDialog({ task, issue, blocked, busy, submit, close, t }: PropsLocale<'workbench'> & {
  task: ScheduledTask; issue?: ScheduledActionFailure; blocked: boolean; busy: boolean;
  submit: () => void; close: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const heading = useId();
  const description = useId();
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    cancelRef.current?.focus();
    return () => dialog.close();
  }, []);
  return createPortal(<dialog ref={dialogRef} className="wb-edit-project wb-remove-project"
    aria-labelledby={heading} aria-describedby={description}
    onCancel={event => { event.preventDefault(); if (!busy) close(); }}>
    <form onSubmit={event => { event.preventDefault(); if (!blocked && !busy) submit(); }}>
      <header><strong id={heading}>{t('scheduledDeleteTask')} · {task.title}</strong></header>
      <p id={description}>{t('scheduledDeleteConfirm')}</p>
      {issue && <p role="alert">{t(issue)}</p>}
      <footer>
        <button type="button" ref={cancelRef} disabled={busy} onClick={close}>{t('cancel')}</button>
        <button type="submit" className="wb-remove-local" disabled={blocked || busy}>{t('scheduledDelete')}</button>
      </footer>
    </form>
  </dialog>, document.body);
}

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

export function ScheduledNavigation({ useScheduledTasks, useRemoteAccess, nativeText, scheduleAction, t }: Props) {
  const title = t('scheduled');
  const active = t('active');
  const search = t('scheduledSearch');
  const tasks = useScheduledTasks(snapshot => snapshot);
  const navigation = useRef<HTMLElement>(null);
  const cancel = useRef<() => void>();
  const [selected, setSelected] = useState<string>();
  const [menu, setMenu] = useState<TaskMenu>();
  const [confirmation, setConfirmation] = useState<ScheduledTask>();
  const [failure, setFailure] = useState<ScheduledActionFailure>();
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const canEdit = useRemoteAccess('schedule/edit');
  const canRun = useRemoteAccess('schedule/run');
  const closeMenu = useCallback(() => setMenu(undefined), []);
  const menuTask = tasks.find(task => task.id === menu?.taskId);
  const taskBeingDeleted = tasks.find(task => task.id === confirmation?.id);
  const deleteIssue = !confirmation ? undefined : !taskBeingDeleted ? 'scheduledActionMissing'
    : taskBeingDeleted.updatedAt !== confirmation.updatedAt ? 'scheduledActionConflict' : undefined;

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

  function openMenu(task: ScheduledTask, restore: HTMLElement, point?: { x: number; y: number }) {
    const bounds = restore.getBoundingClientRect();
    setMenu({ taskId: task.id, restore, label: t('scheduledTaskMenu') + ' · ' + task.title,
      x: point?.x ?? bounds.right, y: point?.y ?? bounds.bottom, align: point ? undefined : 'end' });
  }

  function keyMenu(event: KeyboardEvent<HTMLButtonElement>, task: ScheduledTask) {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
    event.preventDefault();
    event.stopPropagation();
    openMenu(task, event.currentTarget);
  }

  async function runAction(action: ScheduledAction, task: ScheduledTask) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setFailure(undefined);
    try {
      const issue = await scheduleAction(action, task);
      setFailure(issue);
      if (action === 'delete' && !issue) setConfirmation(undefined);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  function taskEntries(task: ScheduledTask): MenuEntry[] {
    const paused = task.status === 'paused';
    const editable = !busy && canEdit && !task.executionActive;
    const runBlocked = task.deliveryFloorEndsAt !== undefined && Date.parse(task.deliveryFloorEndsAt) > Date.now();
    return [
      { label: t(paused ? 'scheduledResume' : 'scheduledPause'), icon: paused ? 'resume' : 'pause',
        run: editable && task.status !== 'ended' ? () => { void runAction('toggle', task); } : undefined },
      { label: t('scheduledRun'), icon: 'run', disabledReason: runBlocked ? t('scheduledExecutionPending') : undefined,
        run: !busy && canRun && !task.executionActive && !runBlocked ? () => { void runAction('run', task); } : undefined },
      { label: t('edit'), icon: 'rename', run: () => act(page => openNativeTask(page, task, nativeText)) },
      { label: t('share'), icon: 'share', disabledReason: t('scheduledShareUnavailable') },
      { label: t('scheduledDelete'), icon: 'trash', danger: true,
        run: editable ? () => { setFailure(undefined); setConfirmation(task); } : undefined },
    ];
  }

  const locale = nativeText('time.locale');
  const rows = (status: 'active' | 'paused') => tasks
    .filter(task => task.status === status)
    .sort((left, right) => left.scheduledAt.localeCompare(right.scheduledAt))
    .map(task => {
      const run = nextRun(task, locale);
      const timing = [run, nativeText(recurrence(task))].filter(Boolean).join(' · ');
      return <div key={task.id} className="wb-scheduled-item"
        onContextMenu={event => {
          event.preventDefault();
          const row = event.currentTarget.querySelector<HTMLElement>('[data-workbench-scheduled-task]');
          if (row) openMenu(task, row, event.clientX || event.clientY ? { x: event.clientX, y: event.clientY } : undefined);
        }}>
        <button type="button" className="wb-scheduled-row" data-workbench-scheduled-task={task.id}
          aria-current={selected === task.id ? 'true' : undefined} title={task.title}
          onKeyDown={event => keyMenu(event, task)} onClick={() => act(page => openNativeTask(page, task, nativeText))}>
          <span>{task.title}</span><small>{timing}</small>
        </button>
        <button type="button" className="wb-scheduled-more" aria-label={t('scheduledTaskActions') + ' · ' + task.title}
          aria-haspopup="menu" aria-expanded={menu?.taskId === task.id}
          onKeyDown={event => keyMenu(event, task)}
          onClick={event => openMenu(task, event.currentTarget)}><Glyph icon="more" /></button>
      </div>;
    });
  const activeTasks = rows('active');
  const pausedTasks = rows('paused');

  return <nav ref={navigation} className="wb-scheduled-navigation" data-workbench-scheduled-navigation aria-label={title}>
    <div className="wb-scheduled-title">{title}</div>
    <button type="button" className="wb-scheduled-new" data-workbench-scheduled-new
      onClick={() => act(page => createNativeTask(page, nativeText))}><Glyph icon="add" />{t('scheduledNewTask')}</button>
    {failure && !confirmation && <SidebarNotice message={t(failure)} closeLabel={t('close')} onClose={() => setFailure(undefined)} />}
    <div className="wb-scheduled-group" data-workbench-scheduled-group="active">
      <div className="wb-scheduled-group-title">{active}</div>
      {activeTasks}
    </div>
    <details className="wb-scheduled-paused" data-workbench-scheduled-paused>
      <summary>{nativeText('status.paused')}<Glyph icon="section" /></summary>
      {pausedTasks.length ? pausedTasks : <p>{nativeText('list.emptyPaused')}</p>}
    </details>
    {menu && menuTask && <RowMenu target={{ ...menu, entries: taskEntries(menuTask) }}
      close={closeMenu} unavailable={t('actionUnavailable')} />}
    {confirmation && <DeleteTaskDialog task={confirmation} issue={deleteIssue ?? failure} busy={busy}
      blocked={!canEdit || !!deleteIssue || !!taskBeingDeleted?.executionActive}
      close={() => { setConfirmation(undefined); setFailure(undefined); }}
      submit={() => { void runAction('delete', confirmation); }} t={t} />}
  </nav>;
}
