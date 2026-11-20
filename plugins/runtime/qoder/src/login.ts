import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { LoginView } from './remote.js';

// Only expose the official interactive sign-in URL. Other CLI output stays local.
function signInLink(line: string): string | undefined {
  try {
    const url = new URL(line.trim());
    if (url.origin === 'https://qoder.com' && !url.username && !url.password
      && url.pathname === '/device/selectAccounts' && url.searchParams.has('challenge')) return url.href;
  } catch { /* Most lines are progress messages. */ }
}

export class BrowserLogin {
  view: LoginView = { state: 'idle' };
  private stop?: () => void;

  constructor(private readonly onAuthorized: () => void) {}

  start(executable: string): LoginView {
    if (this.stop) return this.view;
    this.view = { state: 'preparing' };
    const child = spawn(executable, ['login'], {
      env: { ...process.env, CI: '1', NO_COLOR: '1', BROWSER: 'www-browser' },
      stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    const lines = createInterface({ input: child.stdout });
    child.stderr.resume();
    const finish = (state: LoginView['state']) => {
      if (this.stop !== cancel) return;
      clearTimeout(timer);
      lines.close();
      this.stop = undefined;
      this.view = { state };
      if (state === 'authorized') this.onAuthorized();
    };
    const cancel = () => {
      child.kill();
      finish('idle');
    };
    this.stop = cancel;
    const timer = setTimeout(() => {
      child.kill();
      finish('expired');
    }, 5 * 60_000);
    lines.on('line', line => {
      const url = signInLink(line);
      if (this.stop === cancel && url) this.view = { state: 'waiting', url };
    });
    child.once('error', () => finish('failed'));
    child.once('close', code => finish(code === 0 ? 'authorized' : 'failed'));
    return this.view;
  }

  cancel(): LoginView {
    this.stop?.();
    return this.view;
  }
}
