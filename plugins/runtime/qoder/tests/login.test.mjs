import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { BrowserLogin } from '../lib/login.js';

test('browser login shares one attempt, cancels, retries and publishes success once', {
  skip: process.platform === 'win32',
}, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'qoder-login-test-'));
  const cli = join(dir, 'qodercli');
  const url = 'https://qoder.com/device/selectAccounts?challenge=synthetic';
  let completed = 0;
  const login = new BrowserLogin(() => { completed++; });
  async function waitFor(state) {
    for (let i = 0; i < 150 && login.view.state !== state; i++) await delay(20);
    assert.equal(login.view.state, state);
  }
  try {
    await writeFile(cli, '#!/bin/sh\necho https://wrong.example/device/selectAccounts?challenge=other\nexit 1\n', { mode: 0o755 });
    login.start(cli);
    await waitFor('failed');
    assert.equal(login.view.url, undefined);
    await writeFile(cli, `#!/bin/sh\nprintf '%s\\n' '${url}'\nexec sleep 15\n`);
    login.start(cli);
    await waitFor('waiting');
    assert.equal(login.start(cli).url, url);
    assert.deepEqual(login.cancel(), { state: 'idle' });
    await writeFile(cli, '#!/bin/sh\nexit 0\n');
    login.start(cli);
    await waitFor('authorized');
    assert.equal(completed, 1);
    assert.equal(login.view.url, undefined);
  } finally {
    login.cancel();
    await rm(dir, { recursive: true, force: true });
  }
});
