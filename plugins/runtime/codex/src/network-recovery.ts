import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { RetryId } from '@deepseek-ai/dsh-llm-retry/types';
import { LlmError } from '@deepseek-ai/dsh-llm';
import { CODEX_CONNECTION_FAILED } from './network-failure.js';

const POLICY_KEY = 'dsh-codex:wait-for-network:v1';
const WAIT_LIMIT_MS = 10 * 60_000;
const INITIAL_DELAY_MS = 5_000;
const MAX_DELAY_MS = 60_000;
// At most 12 requests can resume before the deadline (5+10+20+40+8×60=555s).
// The 13th wait covers the remaining time and is closed by the deadline, not dispatched.
const MAX_WAIT_EVENTS = 13;

interface NetworkRecoveryClock {
  now(): number;
  wait(ms: number, signal: AbortSignal): Promise<void>;
}
const realClock: NetworkRecoveryClock = {
  now: Date.now,
  wait: (ms, signal) => delay(ms, undefined, { signal }),
};

interface WaitState {
  route: AbortSignal;
  turn: number;
  step: number;
  start: number;
  retry: number;
  retryId: RetryId;
}

/** Independent recovery for recognized connection failures on Desktop account routes. */
export function installNetworkRecovery(ctx: Context, routeSignal: (provider: string) => AbortSignal | undefined,
  clock = realClock): void {
  const waits = new WeakMap<Agent, WaitState>();
  ctx.on('agent/request-error', async ({ agent, turn, step, provider, failure, signal }, next) => {
    const route = routeSignal(provider);
    if (!route || failure.code !== CODEX_CONNECTION_FAILED) return next();
    const recoverySignal = AbortSignal.any([signal, route]);
    if (recoverySignal.aborted) return;

    // Wall time counts sleep toward the deadline; the timer itself does not wake the Mac.
    const now = clock.now();
    let state = waits.get(agent);
    if (!state || state.route !== route || state.turn !== turn || state.step !== step) {
      state = { route, turn, step, start: now, retry: 0, retryId: randomUUID() as RetryId };
      waits.set(agent, state);
    }
    const deadline = state.start + WAIT_LIMIT_MS;
    // TRANSPORT preserves the host's manual Continue action; throwing here closes
    // the step without falling back to a second automatic retry policy.
    const expired = () => new LlmError('等待 Codex 网络连接已超时（10 分钟）。请检查网络后再试。', 'TRANSPORT');
    if (now >= deadline || state.retry >= MAX_WAIT_EVENTS) throw expired();

    const delayMs = Math.min(INITIAL_DELAY_MS * 2 ** state.retry, MAX_DELAY_MS, deadline - now);
    const { retryId } = state;
    const retry = ++state.retry;
    // Keep the native retry display finite and its state separate from stock request retries.
    agent.session.append('llm/retry', { retryId, turn, step, provider, mode: 'normal', maxRetries: MAX_WAIT_EVENTS,
      policyKey: POLICY_KEY, retry, delayMs, failure });
    try { await clock.wait(delayMs, recoverySignal); }
    catch (error) { if (recoverySignal.aborted) return; throw error; }
    if (recoverySignal.aborted) return;
    if (clock.now() >= deadline) throw expired();
    agent.session.append('llm/retry-started', { retryId, turn, step, retry });
    return { kind: 'retry' };
  }, { prepend: true });
}
