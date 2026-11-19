import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { record } from './local.js';

export async function readCodexUsage(executable: string, home: string, signal: AbortSignal) {
  const timeout = AbortSignal.any([signal, AbortSignal.timeout(8000)]);
  timeout.throwIfAborted();
  const child = spawn(executable, ['app-server'], {
    env: { ...process.env, CODEX_HOME: home }, signal: timeout, stdio: ['pipe', 'pipe', 'ignore'],
  });
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const close = () => lines.close();
  child.on('error', close);
  child.stdin.on('error', close);
  const send = (message: object) => child.stdin.write(JSON.stringify(message) + '\n');
  try {
    send({ id: 1, method: 'initialize', params: {
      clientInfo: { name: 'dsh_codex', title: 'DSH Codex', version: '0.1.4' },
    } });
    for await (const line of lines) {
      const message = parseLine(line);
      if (message.error !== undefined && (message.id === 1 || message.id === 2)) return null;
      if (message.id === 1) {
        send({ method: 'initialized' });
        send({ id: 2, method: 'account/rateLimits/read' });
      }
      if (message.id === 2) return projectRateLimits(message.result);
    }
    return null;
  } finally {
    lines.close();
    child.stdin.destroy();
    child.kill();
  }
}

function parseLine(line: string) {
  try {
    return record(JSON.parse(line));
  } catch {
    return {};
  }
}

export function projectRateLimits(result: unknown) {
  const value = record(result);
  const rates = record(record(value.rateLimitsByLimitId).codex ?? value.rateLimits);
  const windows = [rates.primary, rates.secondary].flatMap(window => {
    const { usedPercent, windowDurationMins, resetsAt } = record(window);
    if (typeof usedPercent !== 'number' || !Number.isFinite(usedPercent)) return [];
    return [{
      remainingPercent: Math.round(100 - Math.max(0, Math.min(usedPercent, 100))),
      minutes: typeof windowDurationMins === 'number' && Number.isFinite(windowDurationMins) && windowDurationMins > 0
        ? windowDurationMins : 0,
      ...(typeof resetsAt === 'number' && Number.isFinite(resetsAt) && resetsAt > 0 ? { resetsAt } : {}),
    }];
  });
  return windows.length ? { windows } : null;
}
