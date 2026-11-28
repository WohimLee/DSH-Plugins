import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { RetryId } from '@deepseek-ai/dsh-llm-retry/types';
import { LlmError } from '@deepseek-ai/dsh-llm';
import { MODEL_CONNECTION_FAILED } from './model-network-failure.js';

const POLICY_KEY = 'dsh-plugins:wait-for-network:v1';
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

interface ConnectionPermit {
  route: AbortSignal;
  account?: string;
}

// Agent Loop passes the same turn signal to its adapter and request-error handler.
// Keep account generations in memory, never in serializable failure facts or the log.
const permits = new WeakMap<AbortSignal, Map<string, ConnectionPermit>>();

export function bindNetworkFailure(signal: AbortSignal | undefined, provider: string, route: AbortSignal, account?: string): void {
  if (!signal || signal.aborted || route.aborted) return;
  let routes = permits.get(signal);
  if (!routes) { routes = new Map(); permits.set(signal, routes); }
  if (!routes.has(provider)) routes.set(provider, { route, account });
}

export function clearNetworkFailure(signal: AbortSignal | undefined, provider: string): void {
  if (signal) permits.get(signal)?.delete(provider);
}

function connectionChanged(): LlmError {
  return new LlmError('模型连接在等待网络期间已变更。请确认账号后再试。', 'AUTH');
}

/** Reject retransmission if the original connection generation or account has changed. */
export function assertNetworkRoute(signal: AbortSignal | undefined, provider: string, route: AbortSignal, account?: string): void {
  const permit = signal && permits.get(signal)?.get(provider);
  if (permit && (permit.route !== route || permit.route.aborted || permit.account !== account)) throw connectionChanged();
}

interface WaitState {
  route: AbortSignal;
  turn: number;
  step: number;
  start: number;
  retry: number;
  retryId: RetryId;
}

/** Independent recovery for recognized connection failures on explicitly registered routes. */
export function installNetworkRecovery(ctx: Context, routeSignal: (provider: string) => AbortSignal | undefined,
  clock = realClock): void {
  const waits = new WeakMap<Agent, WaitState>();
  ctx.on('agent/request-error', async ({ agent, turn, step, provider, failure, signal }, next) => {
    if (failure.code !== MODEL_CONNECTION_FAILED) return next();
    const permit = permits.get(signal)?.get(provider);
    if (!permit) return next();
    const { route } = permit;
    const current = routeSignal(provider);
    if (!current) return next(); // Another adapter can own this permit in a multi-route plugin.
    if (signal.aborted) return;
    if (current !== route || route.aborted) throw connectionChanged();
    const recoverySignal = AbortSignal.any([signal, route]);

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
    const expired = () => new LlmError('等待模型网络连接已超时（10 分钟）。请检查网络后再试。', 'TRANSPORT');
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
