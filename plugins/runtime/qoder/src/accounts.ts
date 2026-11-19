import { createHash } from 'node:crypto';
import { LlmError } from '@deepseek-ai/dsh-llm';
import type { LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm';
import { accessToken, qodercliAuth } from '@qoder-ai/qoder-agent-sdk';
import type { AuthOptions, ModelInfo } from '@qoder-ai/qoder-agent-sdk';
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials';
import { AccountStore, accountLabel, accountRoute } from './account-store.js';
import type { AccountConfig, AccountEntry } from './account-store.js';
import type { AccountChange, AccountView } from './remote.js';

interface CatalogEntry {
  key: string;
  expires: number;
  models: Promise<LlmResolvedModelInfo[]>;
}

export class QoderAccounts {
  private accounts = new Map<string, AccountEntry>();
  private readonly store: AccountStore;
  private readonly cache = new Map<string, CatalogEntry>();

  constructor(
    accounts: AccountConfig[] | undefined,
    private readonly resolveSecret: (ref: string) => Promise<string | undefined>,
    private readonly readCatalog: (auth: AuthOptions) => Promise<ModelInfo[]>,
    credentials: () => CredentialProvider | undefined,
  ) {
    this.store = new AccountStore(accounts, credentials, resolveSecret);
    for (const account of this.store.initial()) this.accounts.set(accountRoute(account.id), account);
  }

  async reload(): Promise<void> {
    const entries = await this.store.load();
    const accounts = new Map(entries.map(account => [accountRoute(account.id), account]));
    for (const provider of this.accounts.keys()) {
      if (!accounts.has(provider)) this.cache.delete(provider);
    }
    this.accounts = accounts;
  }

  async change(change: AccountChange): Promise<boolean> {
    return this.store.change(change, change.kind === 'add' ? undefined : this.accounts.get(change.provider));
  }

  get providers(): string[] {
    return ['qoder', ...this.accounts.keys()];
  }

  providerName(provider: string): string {
    const account = this.accounts.get(provider);
    return account ? `Qoder · ${accountLabel(account)}` : 'Qoder';
  }

  async auth(provider: string): Promise<AuthOptions> {
    const account = this.accounts.get(provider);
    if (provider !== 'qoder' && !account) {
      throw new LlmError('找不到所选 Qoder 账号。', 'UNKNOWN_MODEL');
    }
    const token = (await (account ? this.store.token(account) : this.resolveSecret('QODER_PERSONAL_ACCESS_TOKEN')))?.trim();
    if (token) return accessToken(token);
    if (!account) return qodercliAuth();
    throw new LlmError('请在 DSH 设置 → Qoder 账号中绑定所选账号。', 'MISSING_CREDENTIAL');
  }

  async listModels(provider: string, auth: AuthOptions): Promise<LlmResolvedModelInfo[]> {
    const token = auth.type === 'accessToken' && typeof auth.accessToken === 'string' ? auth.accessToken : undefined;
    const key = token ? createHash('sha256').update(token).digest('hex') : 'cli';
    const current = this.cache.get(provider);
    if (current?.key === key && current.expires > Date.now()) return current.models;
    const enabled = this.accounts.get(provider)?.models;
    const entry: CatalogEntry = {
      key,
      expires: Infinity,
      models: this.readCatalog(auth).then(catalog => {
        entry.expires = Date.now() + (catalog.length ? 60_000 : 5_000);
        const models = new Map<string, LlmResolvedModelInfo>();
        for (const model of catalog) {
          const id = model.value?.trim();
          if (!id || model.isEnabled === false || (enabled && !enabled.includes(id))) continue;
          models.set(id, {
            provider, id, name: model.displayName?.trim() || id,
            inputModalities: ['text'], description: model.description?.trim() || undefined,
          });
        }
        return [...models.values()];
      }).catch(error => {
        if (this.cache.get(provider) === entry) this.cache.delete(provider);
        throw error;
      }),
    };
    this.cache.set(provider, entry);
    return entry.models;
  }

  invalidate(ref?: string): string[] {
    const routes = ref === undefined ? this.providers
      : this.providers.filter(route => (this.accounts.get(route)?.tokenEnv ?? 'QODER_PERSONAL_ACCESS_TOKEN') === ref);
    for (const route of routes) this.cache.delete(route);
    return routes;
  }

  async statusOf(provider: string): Promise<AccountView> {
    const config = this.accounts.get(provider);
    const account = { provider, name: config ? accountLabel(config) : 'Qoder CLI', remark: config?.remark };
    try {
      const auth = await this.auth(provider);
      const models = await this.listModels(provider, auth);
      return { ...account, state: models.length ? 'connected' : 'noModels', modelCount: models.length };
    } catch (error) {
      const code = error instanceof LlmError ? error.failure.code : undefined;
      const state = code === 'MISSING_CREDENTIAL' ? 'unbound'
        : code === 'INVALID_CONFIG' ? 'cliMissing'
        : code === 'AUTH' ? 'authFailed'
        : 'unavailable';
      return { ...account, state, modelCount: 0 };
    }
  }
}
