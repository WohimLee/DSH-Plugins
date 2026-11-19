import { randomBytes } from 'node:crypto';
import { credentialKey, credentialKeyId, credentialKeyScope, credentialRef } from '@deepseek-ai/dsh-credentials';
import type { CredentialProvider, CredentialRecord } from '@deepseek-ai/dsh-credentials';
import { LlmError } from '@deepseek-ai/dsh-llm';
import type { AccountChange } from './remote.js';

const scope = 'dsh-qoder';
const prefix = 'qoder-account-';
const managedId = /^a-[0-9a-f]{24}$/;

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
}

interface AccountRecord {
  version: 1;
  remark: string;
  token?: string;
}

const legacy = [
  { id: 'personal', tokenEnv: 'QODER_PERSONAL_PAT' },
  { id: 'work', tokenEnv: 'QODER_WORK_PAT' },
];

function readRecord(record?: CredentialRecord): AccountRecord | undefined {
  if (record?.kind !== 'grant' || !record.payload || typeof record.payload !== 'object') return;
  const { version, remark, token } = record.payload as Partial<AccountRecord>;
  if (version === 1 && typeof remark === 'string' && remark.length <= 80 &&
      (token === undefined || (typeof token === 'string' && token.trim()))) {
    return { version, remark, token };
  }
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
        return record?.token ? { id: credentialKeyId(entry.key), remark: record.remark } : undefined;
      }));
    return [...accounts, ...managed.filter(account => account !== undefined)];
  }

  async token(account: AccountEntry): Promise<string | undefined> {
    if (account.tokenEnv) return this.resolveSecret(account.tokenEnv);
    return readRecord(await this.credentials()?.readRecord(credentialKey(scope, account.id)))?.token;
  }

  async change(change: AccountChange, account?: AccountEntry): Promise<boolean> {
    const credentials = this.credentials();
    if (!credentials) return false;
    if (change.kind === 'add') {
      const key = credentialKey(scope, `a-${randomBytes(12).toString('hex')}`);
      await credentials.modifyRecord(key, async current => {
        if (current) throw new Error('Qoder account ID collision');
        return { kind: 'grant', payload: { version: 1, remark: change.remark, token: change.token } };
      });
      return true;
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
      if (!account.tokenEnv && !record?.token) return;
      changed = true;
      const token = change.kind === 'replace' ? change.token : record?.token;
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
