import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { channel } from 'node:diagnostics_channel';
import { once } from 'node:events';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { withDaemonStdinGuard } from '../lib/daemon-stdin.js';

test('a queued SDK write after pipe shutdown rejects its callback without escaping the daemon', async () => {
  // The Node child stands in for the CLI and exposes the same stdin transport.
  const start = () => spawn(process.execPath, ['-e', 'process.stdin.resume()', '--', '--sdk'], { stdio: ['pipe', 'ignore', 'ignore'] });
  const children = [];
  const pending = Promise.withResolvers();
  const started = Promise.withResolvers();
  const channelBefore = channel('child_process').hasSubscribers;
  try {
    const guarded = withDaemonStdinGuard(process.execPath, async () => {
      await setImmediate();
      const child = start();
      children.push(child);
      await once(child, 'spawn');
      started.resolve(child);
      await pending.promise;
    });
    const child = await started.promise;
    // Identical executable and args, concurrently started by another plugin.
    const unrelated = start();
    children.push(unrelated);
    await once(unrelated, 'spawn');
    assert.equal(unrelated.stdin.listenerCount('error'), 0);
    pending.resolve();
    await guarded;
    assert.equal(channel('child_process').hasSubscribers, channelBefore);

    child.stdin.end();
    const failure = await new Promise(resolve => child.stdin.write('queued frame', resolve));
    assert.equal(failure.code, 'ERR_STREAM_WRITE_AFTER_END');
    await setImmediate(); // drain the additional stream 'error' event
  } finally {
    pending.resolve();
    for (const child of children) child.kill();
  }
});
