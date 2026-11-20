import { AsyncLocalStorage } from 'node:async_hooks';
import { ChildProcess } from 'node:child_process';
import { channel } from 'node:diagnostics_channel';

const launches = new AsyncLocalStorage<symbol>();
const children = channel('child_process');

// SDK 1.0.59 rejects its write promise via the callback, but the same failed
// write emits 'error' on the pipe. Node throws that second notification if
// there is no listener. Keep this listener for the lifetime of this pipe.
function onStdinError(): void {}

export async function withDaemonStdinGuard<T>(cliPath: string, start: () => Promise<T>): Promise<T> {
  const launch = Symbol();
  function observe(event: unknown): void {
    if (launches.getStore() !== launch) return;
    const child = (event as { process: ChildProcess }).process;
    if (!(child instanceof ChildProcess)) return;
    child.once('spawn', () => {
      if (child.spawnargs.includes(cliPath) && child.spawnargs.includes('--sdk')) {
        child.stdin?.on('error', onStdinError);
      }
    });
  }

  // The SDK owns spawn() and exposes neither its ChildProcess nor its stdin.
  children.subscribe(observe);
  try {
    return await launches.run(launch, start);
  } finally {
    children.unsubscribe(observe);
  }
}
