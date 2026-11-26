import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-api-remotes/client';
import type { ScheduledTask } from './scheduled-source.js';

export type ScheduledAction = 'toggle' | 'run' | 'delete';
export type ScheduledActionFailure = 'scheduledActionFailed' | 'scheduledActionConflict' | 'scheduledActionMissing' | 'scheduledExecutionPending';

export function scheduleAction(ctx: Context) {
  return async (action: ScheduledAction, task: ScheduledTask): Promise<ScheduledActionFailure | undefined> => {
    const schedule = ctx.get('remote.schedule');
    if (!schedule) return 'scheduledActionFailed';
    const revision = { id: task.id, expectedUpdatedAt: task.updatedAt ?? null };
    try {
      const result = action === 'run' ? await schedule.run({ id: task.id })
        : await schedule.edit(action === 'delete' ? { ...revision, action: 'delete' }
          : { ...revision, action: 'update', patch: { active: task.status !== 'active' } });
      if (!result.ok) return 'scheduledActionFailed';
      if (!('code' in result.value)) return;
      if (result.value.code === 'schedule_conflict') return 'scheduledActionConflict';
      if (result.value.code === 'schedule_execution_pending') return 'scheduledExecutionPending';
      return 'scheduledActionMissing';
    } catch {
      return 'scheduledActionFailed';
    }
  };
}
