import { randomBytes } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { credentialKey, credentialKeyId, credentialKeyScope, credentialRef } from '@deepseek-ai/dsh-credentials';
import type { CredentialProvider, CredentialRecord } from '@deepseek-ai/dsh-credentials';
import { LlmError } from '@deepseek-ai/dsh-llm';
import type { AccountChange, AccountChangeResult } from './remote.js';

const scope = 'dsh-qoder';
const prefix = 'qoder-account-';
const managedId = /^(?:a|d)-[0-9a-f]{24}$/;

export interface AccountConfig {
  id: string;
  name: string;
  tokenEnv: string;
  models?: string[];
}

export interface AccountEntry {
  id: string;
  remark: string;
  tokenEnv?: string;
  models?: string[];
  profile?: DesktopProfile;
}

export interface DesktopProfile {
  configDir: string;
  identity: string;
}

type AccountRecord = { version: 1; remark: string; token?: string }
  | { version: 2; remark: string; profile: DesktopProfile };

const legacy = [
  { id: 'personal', tokenEnv: 'QODER_PERSONAL_PAT' },
  { id: 'work', tokenEnv: 'QODER_WORK_PAT' },
];

function readRecord(record?: CredentialRecord): AccountRecord | undefined {
  if (record?.kind !== 'grant' || !record.payload || typeof record.payload !== 'object') return;
  const payload = record.payload as Partial<AccountRecord>;
  if (typeof payload.remark !== 'string' || payload.remark.length > 80) return;
  if (payload.version === 1 && (payload.token === undefined ||
    (typeof payload.token === 'string' && payload.token.trim()))) {
    return { version: 1, remark: payload.remark, token: payload.token };
  }
  if (payload.version === 2 && typeof payload.profile?.configDir === 'string' &&
    isAbsolute(payload.profile.configDir) && typeof payload.profile.identity === 'string' &&
    /^[0-9a-f]{64}$/.test(payload.profile.identity)) {
    return { version: 2, remark: payload.remark, profile: payload.profile };
  }
}

export async function desktopDirectory(path: string): Promise<string> {
  if (!isAbsolute(path) || /[\u0000-\u001f]/.test(path)) {
    throw new LlmError('Qoder 桌面账号需要本机配置目录的绝对路径。', 'INVALID_REQUEST');
  }
  const directory = await realpath(path).catch(() => undefined);
  const status = directory && await stat(directory).catch(() => undefined);
  const uid = process.getuid?.();
  const defaultDir = process.env.QODER_CONFIG_DIR || join(homedir(), '.qoder');
  const defaultPath = await realpath(defaultDir).catch(() => undefined);
  if (!directory || !status || !status.isDirectory() || directory === defaultPath ||
    (uid !== undefined && (status.uid !== uid || (status.mode & 0o022) !== 0))) {
    throw new LlmError('请使用独立、可访问且仅由当前用户写入的 Qoder 配置目录。', 'INVALID_REQUEST');
  }
  return directory;
}

export function accountRoute(id: string): string {
  return prefix + id;
}

export function accountLabel(account: AccountEntry): string {
  const id = account.id === 'personal' ? '01' : account.id === 'work' ? '02' : account.id.slice(-6);
  return account.remark || `Account ${id}`;
}

export class AccountStore {
  private readonly configured: AccountEntry[];
  private readonly legacy: boolean;

  constructor(
    config: AccountConfig[] | undefined,
    private readonly credentials: () => CredentialProvider | undefined,
    private readonly resolveSecret: (ref: string) => Promise<string | undefined>,
  ) {
    const usedRefs = new Set(['QODER_PERSONAL_ACCESS_TOKEN']);
    const ids = new Set<string>();
    this.configured = (config ?? []).map(account => {
      if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(account.id) || !account.name.trim()
        || !/^[_A-Za-z][_A-Za-z0-9]*$/.test(account.tokenEnv)
        || account.models?.some(model => !model.trim()) || ids.has(account.id) || usedRefs.has(account.tokenEnv)) {
        throw new LlmError('Qoder 账号配置包含无效或重复的账号、凭据引用或模型 ID。', 'INVALID_CONFIG');
      }
      ids.add(account.id);
      usedRefs.add(account.tokenEnv);
      return { id: account.id, remark: account.name.trim(), tokenEnv: account.tokenEnv, models: account.models?.slice() };
    });
    this.legacy = config === undefined;
  }

  initial(): AccountEntry[] {
    return this.configured;
  }

  async load(): Promise<AccountEntry[]> {
    const credentials = this.credentials();
    const refs = this.legacy ? (await Promise.all(legacy.map(async account =>
      (await this.resolveSecret(account.tokenEnv))?.trim() ? { ...account, remark: '' } : undefined)))
      .filter(account => account !== undefined) : [];
    const accounts = await Promise.all([...this.configured, ...refs].map(async account => {
      const saved = readRecord(await credentials?.readRecord(credentialKey(scope, account.id)));
      return { ...account, remark: saved?.remark ?? account.remark };
    }));
    if (!credentials) return accounts;
    const records = await credentials.listRecords();
    const managed = await Promise.all(records
      .filter(entry => credentialKeyScope(entry.key) === scope && managedId.test(credentialKeyId(entry.key))
        && !this.configured.some(account => account.id === credentialKeyId(entry.key)))
      .map(async entry => {
        const record = readRecord(await credentials.readRecord(entry.key));
        const id = credentialKeyId(entry.key);
        if (record?.version === 1 && record.token && id.startsWith('a-')) return { id, remark: record.remark };
        if (record?.version === 2 && id === this.profileId(record.profile)) {
          return { id, remark: record.remark, profile: record.profile };
        }
      }));
    return [...accounts, ...managed.filter(account => account !== undefined)];
  }

  async token(account: AccountEntry): Promise<string | undefined> {
    if (account.tokenEnv) return this.resolveSecret(account.tokenEnv);
    const record = readRecord(await this.credentials()?.readRecord(credentialKey(scope, account.id)));
    return record?.version === 1 ? record.token : undefined;
  }

  async defaultRemark(browserLogin: boolean): Promise<string | undefined> {
    const credentials = this.credentials();
    if (!credentials) return;
    const key = credentialKey(scope, browserLogin ? 'default-cli-remark' : 'default-pat-remark');
    return readRecord(await credentials.readRecord(key))?.remark ?? '';
  }

  async setDefaultRemark(browserLogin: boolean, remark: string): Promise<boolean> {
    const credentials = this.credentials();
    if (!credentials) return false;
    const key = credentialKey(scope, browserLogin ? 'default-cli-remark' : 'default-pat-remark');
    await credentials.modifyRecord(key, async () => ({ kind: 'grant', payload: { version: 1, remark } }));
    return true;
  }

  private profileId(profile: DesktopProfile): string {
    return 'd-' + profile.identity.slice(0, 24);
  }

  async addDesktop(profile: DesktopProfile, remark: string, reportProvider = false): Promise<AccountChangeResult> {
    const credentials = this.credentials();
    const id = this.profileId(profile);
    if (!credentials || this.configured.some(account => account.id === id)) return false;
    let added = false;
    await credentials.modifyRecord(credentialKey(scope, id), async current => {
      if (current) return;
      added = true;
      return { kind: 'grant', payload: { version: 2, remark, profile } };
    });
    return added && reportProvider ? accountRoute(id) : added;
  }

  async change(change: Exclude<AccountChange, { kind: 'addDesktop' }>, account?: AccountEntry): Promise<AccountChangeResult> {
    const credentials = this.credentials();
    if (!credentials) return false;
    if (change.kind === 'add') {
      const id = `a-${randomBytes(12).toString('hex')}`;
      const key = credentialKey(scope, id);
      await credentials.modifyRecord(key, async current => {
        if (current) throw new Error('Qoder account ID collision');
        return { kind: 'grant', payload: { version: 1, remark: change.remark, token: change.token } };
      });
      return change.reportProvider ? accountRoute(id) : true;
    }

    if (!account) return false;
    const key = credentialKey(scope, account.id);
    if (change.kind === 'unbind') {
      if (account.tokenEnv) await credentials.unset(credentialRef(account.tokenEnv));
      else await credentials.deleteRecord(key);
      return true;
    }
    if (change.kind === 'replace' && account.tokenEnv) {
      await credentials.set(credentialRef(account.tokenEnv), change.token);
      return true;
    }

    let changed = false;
    await credentials.modifyRecord(key, async current => {
      const record = readRecord(current);
      if (account.profile) {
        if (change.kind !== 'remark' || record?.version !== 2) return;
        changed = true;
        return { kind: 'grant', payload: { ...record, remark: change.remark } };
      }
      const tokenFromRecord = record?.version === 1 ? record.token : undefined;
      if (!account.tokenEnv && !tokenFromRecord) return;
      changed = true;
      const token = change.kind === 'replace' ? change.token : tokenFromRecord;
      const payload: AccountRecord = {
        version: 1,
        remark: change.kind === 'remark' ? change.remark : record?.remark ?? '',
        ...(token === undefined ? {} : { token }),
      };
      return { kind: 'grant', payload };
    });
    return changed;
  }
}

export function isQoderAccountRecord(key: Parameters<typeof credentialKeyScope>[0]): boolean {
  return credentialKeyScope(key) === scope;
}
