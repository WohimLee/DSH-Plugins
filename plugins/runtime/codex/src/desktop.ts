import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { access, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';
import { credentialKey } from '@deepseek-ai/dsh-credentials';
import type { CredentialProvider, CredentialRecord } from '@deepseek-ai/dsh-credentials';
import { loadCredential, record } from './local.js';

export const desktopAccountsKey = credentialKey('dsh-codex', 'desktop-accounts');
const desktopProvider = /^codex-account-[0-9a-f]{24}$/;

export interface DesktopAccount {
  provider: string;
  home: string;
  label: string;
  identity: string;
}

export type DesktopAccountChange = { kind: 'add'; home: string; label: string } | { kind: 'remove'; provider: string };
export type DesktopAccountResult = 'ok' | 'unavailable' | 'invalidHome' | 'signedOut' | 'duplicate' | 'notFound' | 'storage';

export function accountIdentity(accountId: string): string {
  return createHash('sha256').update(accountId).digest('hex');
}

export function readDesktopAccounts(saved?: CredentialRecord): DesktopAccount[] {
  const value = record(saved?.kind === 'grant' ? saved.payload : undefined);
  if (value.version !== 1 || !Array.isArray(value.accounts)) return [];
  return value.accounts.flatMap(raw => {
    const { provider, home, label, identity } = record(raw);
    return typeof provider === 'string' && desktopProvider.test(provider)
      && typeof home === 'string' && isAbsolute(home)
      && typeof label === 'string' && label.trim() !== '' && label.length <= 80
      && typeof identity === 'string' && /^[0-9a-f]{64}$/.test(identity)
      ? [{ provider, home, label, identity }] : [];
  });
}

export async function updateDesktopAccounts(store: CredentialProvider, defaultHome: string, change: DesktopAccountChange,
  signal?: AbortSignal): Promise<DesktopAccountResult> {
  if (change.kind === 'remove') {
    if (!desktopProvider.test(change.provider)) return 'notFound';
    let result: DesktopAccountResult = 'notFound';
    await store.modifyRecord(desktopAccountsKey, async current => {
      signal?.throwIfAborted();
      const accounts = readDesktopAccounts(current);
      const remaining = accounts.filter(account => account.provider !== change.provider);
      if (accounts.length === remaining.length) return;
      result = 'ok';
      return { kind: 'grant', payload: { version: 1, accounts: remaining } };
    });
    return result;
  }

  const label = change.label.trim();
  const selected = change.home.trim();
  if (!label || label.length > 80 || !isAbsolute(selected)) return 'invalidHome';
  const home = await realpath(selected).catch(() => undefined);
  if (!home || !(await stat(home).catch(() => undefined))?.isDirectory()) return 'invalidHome';
  const canonicalDefault = await realpath(defaultHome).catch(() => defaultHome);
  if (home === canonicalDefault) return 'duplicate';
  const auth = await loadCredential(home).catch(() => undefined);
  if (!auth) return 'signedOut';
  const defaultAuth = await loadCredential(defaultHome).catch(() => undefined);
  if (defaultAuth?.accountId === auth.accountId) return 'duplicate';
  const identity = accountIdentity(auth.accountId);
  let result: DesktopAccountResult = 'duplicate';
  await store.modifyRecord(desktopAccountsKey, async current => {
    signal?.throwIfAborted();
    const accounts = readDesktopAccounts(current);
    if (accounts.some(account => account.home === home || account.identity === identity)) return;
    const provider = 'codex-account-' + randomBytes(12).toString('hex');
    result = 'ok';
    return { kind: 'grant', payload: { version: 1, accounts: [...accounts, { provider, home, label, identity }] } };
  });
  return result;
}

export async function findCodexCli(configured?: string): Promise<string | undefined> {
  const executable = process.platform === 'win32' ? 'codex.exe' : 'codex';
  const candidates = configured ? [configured] : [
    ...(process.env.PATH ?? '').split(delimiter).filter(isAbsolute).map(directory => join(directory, executable)),
    join(homedir(), '.local', 'bin', executable),
    ...(process.platform === 'darwin' ? [
      '/opt/homebrew/bin/codex',
      '/usr/local/bin/codex',
      ...['/Applications', join(homedir(), 'Applications')].map(directory =>
        join(directory, 'ChatGPT.app', 'Contents', 'Resources', 'codex-cli', 'bin', executable)),
    ] : []),
  ];
  for (const candidate of new Set(candidates)) {
    if (!(await stat(candidate).catch(() => undefined))?.isFile()) continue;
    const mode = process.platform === 'win32' ? constants.F_OK : constants.X_OK;
    if (await access(candidate, mode).then(() => true, () => false)) return candidate;
  }
}
