import { createHash } from 'node:crypto';
import { LlmError, ReasoningEffortId } from '@deepseek-ai/dsh-llm';
import type { LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm';
import { accessToken, qodercliAuth } from '@qoder-ai/qoder-agent-sdk';
import type { AuthOptions, ModelInfo } from '@qoder-ai/qoder-agent-sdk';
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials';
import { AccountStore, accountLabel, accountRoute, desktopDirectory } from './account-store.js';
import type { AccountConfig, AccountEntry, DesktopProfile } from './account-store.js';
import type { AccountChange, AccountChangeResult, AccountView } from './remote.js';
import type { AccountAuth } from './runtime.js';

interface CatalogEntry {
  key: string;
  expires: number;
  models: Promise<QoderModel[]>;
}

interface QoderModel extends LlmResolvedModelInfo {
  maxOutputTokens?: number;
}

function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function availableModelId(model: ModelInfo, enabled?: string[]): string | undefined {
  const id = model.value?.trim();
  if (id && model.isEnabled !== false && (!enabled || enabled.includes(id))) return id;
}

function resolveCatalogModel(id: string, provider: string, model: ModelInfo, auth: AuthOptions['type'], hasAttachments: boolean): QoderModel {
  const efforts = Array.isArray(model.efforts)
    ? [...new Set(model.efforts.flatMap(level => typeof level === 'string' && level.trim() ? [level.trim()] : []))]
    : [];
  const defaultEffort = model.defaultEffort?.trim();
  const acceptsImages = model.isVl === true && hasAttachments;
  const catalog = auth === 'qodercli' ? 'Qoder CLI 登录目录' : 'Qoder PAT 账号目录';
  const vision = model.isVl === true
    ? (hasAttachments ? '支持图片输入' : '支持图片输入，当前宿主缺少附件服务')
    : model.isVl === false ? '仅支持文本输入' : '未声明图片能力，当前接入仅提供文本输入';
  const context = model.defaultContextWindow;
  const tiers = Array.isArray(model.availableContextWindows) ? model.availableContextWindows.filter(positive) : [];
  const hasWindow = positive(context) && (!tiers.length || tiers.includes(context));
  const details = [model.description?.trim(), catalog + ' · ' + vision,
    hasWindow && '默认上下文 ' + context,
    tiers.length && '厂商上下文档位 ' + tiers.join(' / '),
    positive(model.maxInputTokens) && '最大输入 ' + model.maxInputTokens,
    positive(model.maxOutputTokens) && '最大输出 ' + model.maxOutputTokens];
  return {
    provider, id, name: model.displayName?.trim() || id,
    ...(efforts.length > 0 && { reasoning: {
      efforts: efforts.map(name => {
        const description = model.thinking_config?.enabled?.efforts?.[name]?.description;
        return { id: ReasoningEffortId(name), name, ...(description && { description }) };
      }),
      ...(defaultEffort && efforts.includes(defaultEffort) && { defaultEffort: ReasoningEffortId(defaultEffort) }),
    } }),
    inputModalities: acceptsImages ? ['text', 'image'] : ['text'],
    description: details.filter(Boolean).join(' · '),
    ...(hasWindow && { context: { contextWindow: context } }),
    ...(positive(model.maxOutputTokens) && { maxOutputTokens: model.maxOutputTokens }),
  };
}

export class QoderAccounts {
  private accounts = new Map<string, AccountEntry>();
  private readonly store: AccountStore;
  private readonly cache = new Map<string, CatalogEntry>();

  constructor(
    accounts: AccountConfig[] | undefined,
    private readonly resolveSecret: (ref: string) => Promise<string | undefined>,
    private readonly readCatalog: (auth: AccountAuth) => Promise<ModelInfo[]>,
    credentials: () => CredentialProvider | undefined,
    private readonly hasAttachments: () => boolean,
    private readonly readDisplay: (auth: AccountAuth) => Promise<string | undefined>,
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

  async change(change: Exclude<AccountChange, { kind: 'addDesktop' }>): Promise<AccountChangeResult> {
    if (change.kind === 'remark' && change.provider === 'qoder') {
      const auth = await this.auth('qoder');
      return this.store.setDefaultRemark(auth.type === 'qodercli', change.remark);
    }
    const account = change.kind === 'add' ? undefined : this.accounts.get(change.provider);
    if (change.kind === 'replace' && (!account || account.profile)) return false;
    if (change.kind === 'add' || change.kind === 'replace') {
      try {
        const catalog = await this.readCatalog(accessToken(change.token));
        if (!catalog.some(model => availableModelId(model, account?.models))) return false;
      } catch {
        return false;
      }
    }
    return this.store.change(change, account);
  }

  async addDesktop(profile: DesktopProfile, remark: string, reportProvider?: true): Promise<AccountChangeResult> {
    if ([...this.accounts.values()].some(account => account.profile?.configDir === profile.configDir)) return false;
    return this.store.addDesktop(profile, remark, reportProvider);
  }

  get providers(): string[] {
    return ['qoder', ...this.accounts.keys()];
  }

  providerName(provider: string): string {
    const account = this.accounts.get(provider);
    return account ? `Qoder · ${accountLabel(account)}` : 'Qoder';
  }

  async auth(provider: string): Promise<AccountAuth> {
    const account = this.accounts.get(provider);
    if (provider !== 'qoder' && !account) {
      throw new LlmError('找不到所选 Qoder 账号。', 'UNKNOWN_MODEL');
    }
    if (account?.profile) {
      const profile = account.profile;
      if (await desktopDirectory(profile.configDir).catch(() => undefined) !== profile.configDir) {
        throw new LlmError('Qoder 桌面配置目录已不可用。', 'AUTH');
      }
      return { ...qodercliAuth(), profile };
    }
    const token = (await (account ? this.store.token(account) : this.resolveSecret('QODER_PERSONAL_ACCESS_TOKEN')))?.trim();
    if (token) return accessToken(token);
    if (!account) return qodercliAuth();
    throw new LlmError('请在 DSH 设置 → Qoder 账号中绑定所选账号。', 'MISSING_CREDENTIAL');
  }

  async listModels(provider: string, auth: AccountAuth): Promise<QoderModel[]> {
    const token = auth.type === 'accessToken' && typeof auth.accessToken === 'string' ? auth.accessToken : undefined;
    const hasAttachments = this.hasAttachments();
    const key = (token ? createHash('sha256').update(token).digest('hex')
      : auth.profile ? auth.profile.identity + ':' + auth.profile.configDir : 'cli')
      + (hasAttachments ? ':image' : ':text');
    const current = this.cache.get(provider);
    if (current?.key === key && current.expires > Date.now()) return current.models;
    const enabled = this.accounts.get(provider)?.models;
    const entry: CatalogEntry = {
      key,
      expires: Infinity,
      models: this.readCatalog(auth).then(catalog => {
        entry.expires = Date.now() + (catalog.length ? 60_000 : 5_000);
        const models = new Map<string, QoderModel>();
        for (const model of catalog) {
          const id = availableModelId(model, enabled);
          if (!id) continue;
          models.set(id, resolveCatalogModel(id, provider, model, auth.type, hasAttachments));
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

  refreshCatalogs(): void {
    // A concurrent selection or refresh may already be fetching this same
    // authenticated catalog. Credential changes always invalidate below.
    for (const [provider, entry] of this.cache) {
      if (entry.expires !== Infinity) this.cache.delete(provider);
    }
  }

  invalidate(ref?: string): string[] {
    const routes = ref === undefined ? this.providers
      : this.providers.filter(route => (this.accounts.get(route)?.tokenEnv ?? 'QODER_PERSONAL_ACCESS_TOKEN') === ref);
    for (const route of routes) this.cache.delete(route);
    return routes;
  }

  async statusOf(provider: string, includeIdentity = false): Promise<AccountView> {
    const config = this.accounts.get(provider);
    const account = { provider, name: config ? accountLabel(config) : 'Qoder CLI', remark: config?.remark };
    let browserLogin = config?.profile !== undefined;
    try {
      const auth = await this.auth(provider);
      browserLogin = auth.type === 'qodercli';
      const models = await this.listModels(provider, auth);
      const [identityLabel, remark] = includeIdentity ? await Promise.all([
        this.readDisplay(auth).catch(() => undefined),
        config ? config.remark : this.store.defaultRemark(browserLogin).catch(() => undefined),
      ]) : [undefined, account.remark];
      return { ...account, name: !config && !browserLogin ? 'Qoder PAT' : account.name, remark, identityLabel, browserLogin,
        state: models.length ? 'connected' : 'noModels', modelCount: models.length };
    } catch (error) {
      const code = error instanceof LlmError ? error.failure.code : undefined;
      const state = code === 'MISSING_CREDENTIAL' ? 'unbound'
        : code === 'INVALID_CONFIG' ? 'cliMissing'
        : code === 'AUTH' ? 'authFailed'
        : 'unavailable';
      return { ...account, browserLogin, state, modelCount: 0 };
    }
  }
}
