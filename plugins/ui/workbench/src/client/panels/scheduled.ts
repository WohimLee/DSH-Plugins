import type { ScheduledTask, ScheduledTasks } from '../navigation/scheduled-source.js';

/** Managing or delivering to this Session in the past does not make it the current destination. */
export function summaryScheduledTasks(tasks: ScheduledTasks, sessionId: string): ScheduledTasks {
  return tasks.filter(task => task.target.kind !== 'new' && task.target.sessionId === sessionId
    && (task.status === 'active' || task.status === 'paused'))
    .sort((left, right) => Number(right.status === 'active') - Number(left.status === 'active')
      || taskNextRunAt(left).localeCompare(taskNextRunAt(right)));
}

/** The same later-of-occurrence-and-delivery-floor rule used by native Schedule. */
export function taskNextRunAt(task: Pick<ScheduledTask, 'scheduledAt' | 'deliveryFloorEndsAt'>): string {
  return task.deliveryFloorEndsAt !== undefined && Date.parse(task.deliveryFloorEndsAt) > Date.parse(task.scheduledAt)
    ? task.deliveryFloorEndsAt : task.scheduledAt;
}

export function scheduleFrequency(task: ScheduledTask) {
  if (task.kind === 'after' || task.kind === 'at') return 'summaryFrequencyOnce';
  if (task.kind === 'daily') return 'summaryFrequencyDaily';
  if (task.kind === 'weekly') return 'summaryFrequencyWeekly';
  if (task.kind === 'rrule') {
    if (/(?:^RRULE:|;)COUNT=1(?:;|$)/m.test(task.rrule)) return 'summaryFrequencyOnce';
    const frequency = /(?:^RRULE:|;)FREQ=([A-Z]+)/m.exec(task.rrule)?.[1];
    if (frequency === 'DAILY') return 'summaryFrequencyDaily';
    if (frequency === 'WEEKLY') return 'summaryFrequencyWeekly';
    if (frequency === 'MONTHLY') return 'summaryFrequencyMonthly';
  }
  return 'summaryFrequencyRecurring';
}
