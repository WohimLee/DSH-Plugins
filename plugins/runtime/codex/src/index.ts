import type { Context } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
import { LlmAdapter, LlmError, attributionHeaders } from '@deepseek-ai/dsh-llm';
import type { GenerateOptions, LlmResolvedModelInfo, PreparedAdapterCall, StreamChunk } from '@deepseek-ai/dsh-llm';
import { applyCodexApi } from './api.js';
import { describeModel } from './catalog.js';
import { accountIdentity, desktopAccountsKey, findCodexCli, readDesktopAccounts, updateDesktopAccounts } from './desktop.js';
import type { DesktopAccount, DesktopAccountChange, DesktopAccountResult } from './desktop.js';
import { codexHome, loadCredential, modelsFromCache } from './local.js';
import type { Config as PluginConfig } from './local.js';
import { ModelCache } from './model-cache.js';
import { systemProxy } from './proxy.js';
import { fetch as proxyFetch, type ProxyAgent } from 'undici';
import { buildRequest } from './request.js';
import { httpFailure } from './failure.js';
import { parseStream } from './stream.js';
import { readCodexUsage } from './usage.js';
import { unwatchFile, watchFile } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
export type { Config as PluginConfig } from './local.js';
export const name = 'dsh-codex';
export const inject = ['llm'];
export const Config: Schema<PluginConfig> = Schema.object({
  codexHome: Schema.string().description('Codex 配置目录，默认 CODEX_HOME 或 ~/.codex'),
  codexPath: Schema.string().description('登录检测及额度查询使用的 Codex CLI 绝对路径，省略时自动查找。'),
  models: Schema.union([Schema.const(undefined), Schema.array(Schema.object({
    id: Schema.string().required(), name: Schema.string(),
    inputModalities: Schema.union([Schema.const(undefined), Schema.array(Schema.string())]),
    contextWindow: Schema.number().min(1), efforts: Schema.union([Schema.const(undefined), Schema.array(Schema.string())]), defaultEffort: Schema.string(),
  }))]).description('显式模型列表；省略时读取 Codex models_cache.json'),
});
export const RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses';
export class CodexAdapter extends LlmAdapter {
  private readonly home: string;
  private readonly config: PluginConfig;
  private readonly cache: ModelCache;
  private readonly lifetime = new AbortController();
  constructor(config: PluginConfig = {}, private readonly fetchImpl: typeof fetch = fetch,
    private readonly attachments: () => Context['attachments'] | undefined = () => undefined,
    snapshotRoot?: string, private readonly account?: DesktopAccount) {
    super(); this.config = structuredClone(config); this.home = codexHome(this.config);
    this.cache = new ModelCache(this.home, snapshotRoot);
    if (config.codexPath && !isAbsolute(config.codexPath)) {
      throw new LlmError('Codex CLI 路径必须为绝对路径。', 'INVALID_CONFIG');
    }
  }
  async usage(provider: string, signal: AbortSignal) {
    if (provider !== (this.account?.provider ?? 'codex') || this.account && !(await this.connected())) return null;
    const executable = await findCodexCli(this.config.codexPath);
    if (!executable) return null;
    const usage = await readCodexUsage(executable, this.home, AbortSignal.any([signal, this.lifetime.signal]));
    return !this.account || await this.connected() ? usage : null;
  }
  private async credential() {
    const credential = await loadCredential(this.home);
    if (this.account && accountIdentity(credential.accountId) !== this.account.identity) {
      throw new LlmError('这个目录的 Codex 账号已变更，请重新绑定该目录。', 'AUTH');
    }
    return credential;
  }
  async connected(): Promise<boolean> {
    try {
      await this.credential();
      return true;
    } catch {
      return false;
    }
  }
  dispose(): void { this.lifetime.abort(); }
  override providerInfo(provider: string) { return { id: provider, name: this.account ? `Codex · ${this.account.label}` : 'Codex' }; }
  override async listModels(provider: string): Promise<LlmResolvedModelInfo[]> {
    const credential = await this.credential().catch(() => undefined);
    return credential ? this.modelCatalog(provider, credential.accountId) : [];
  }
  private async modelCatalog(provider: string, accountId: string): Promise<LlmResolvedModelInfo[]> {
    const models = modelsFromCache(await this.cache.read(accountId), this.config.models);
    const hasAttachments = !!this.attachments();
    return models
      .filter(model => model.inputModalities === undefined || model.inputModalities.includes('text'))
      .map(model => describeModel(provider, model, hasAttachments));
  }
  override async resolveModel(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo> {
    signal?.throwIfAborted();
    const { accountId } = await this.credential();
    const info = (await this.modelCatalog(provider, accountId)).find(m => m.id === model);
    signal?.throwIfAborted();
    if (!info) throw new LlmError('Codex 模型不在本地目录中，请更新 Codex 模型缓存或配置 models。', 'UNKNOWN_MODEL');
    return info;
  }
  override async prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<PreparedAdapterCall> {
    const resolved = await this.resolveModel(provider, model, signal);
    return { model: resolved, stream: options => this.streamResolved(options, resolved) };
  }
  override stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    return this.streamResolved(options);
  }
  private async *streamResolved(options: GenerateOptions, prepared?: LlmResolvedModelInfo): AsyncGenerator<StreamChunk> {
    const signal = AbortSignal.any([this.lifetime.signal, ...(options.signal ? [options.signal] : [])]);
    let dispatcher: ProxyAgent | undefined;
    try {
      signal.throwIfAborted();
      const model = prepared ?? await this.resolveModel(options.provider, options.model, signal);
      if (options.reasoningEffort && !model.reasoning?.efforts.some(e => e.id === options.reasoningEffort)) {
        throw new LlmError('所选模型未声明该推理强度。', 'UNSUPPORTED_OPTION');
      }
      const attachments = this.attachments();
      const readImage = model.inputModalities?.includes('image') && attachments
        ? (ref: Parameters<typeof attachments.readImageRequest>[0]) => attachments.readImageRequest(
          ref, this.imageRequestTarget(options.provider, options.model, ref), signal,
        ) : undefined;
      const body = await buildRequest(options, readImage);
      const credential = await this.credential();
      signal.throwIfAborted();
      if (this.fetchImpl === fetch) dispatcher = await systemProxy(new URL(RESPONSES_URL).hostname, signal);
      const init = { method: 'POST', signal,
        headers: { authorization: `Bearer ${credential.accessToken}`, 'chatgpt-account-id': credential.accountId,
          originator: 'codex_cli_rs', 'content-type': 'application/json', accept: 'text/event-stream', ...attributionHeaders() },
        body: JSON.stringify(body), redirect: 'error' as const };
      const response = dispatcher ? await proxyFetch(RESPONSES_URL, { ...init, dispatcher }) : await this.fetchImpl(RESPONSES_URL, init);
      const privateIds = [credential.accessToken, credential.accountId];
      if (!response.ok) throw await httpFailure(response, 'Codex', privateIds, signal);
      if (!response.body) throw new LlmError('Codex 响应没有数据流。', 'INVALID_RESPONSE');
      yield* parseStream(response.body, response.headers, 'Codex', privateIds);
    } catch (error) {
      const aborted = signal.aborted;
      const failure = error instanceof LlmError ? error.failure : { code: 'TRANSPORT', message: 'Codex 网络请求失败，请检查连接。' };
      yield { type: 'finish', reason: { kind: aborted ? 'aborted' : 'error', failure: aborted ? { code: 'ABORTED', message: 'Codex 请求已取消。' } : failure } };
    } finally {
      await dispatcher?.destroy();
    }
  }
}
export function apply(ctx: Context, config: PluginConfig = {}): void {
  const defaultHome = codexHome(config);
  const snapshotRoot = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'cache', 'dsh-codex');
  const routes = new Map<string, { adapter: CodexAdapter; account?: DesktopAccount; dispose: () => void }>();
  let live = true;
  let updates = Promise.resolve();

  function register(provider: string, home: string, account?: DesktopAccount) {
    const adapterConfig = account ? { codexHome: home, codexPath: config.codexPath } : { ...config, codexHome: home };
    const adapter = new CodexAdapter(adapterConfig, fetch, () => ctx.get('attachments'), snapshotRoot, account);
    const release = ctx.llm.registerAdapter([provider], adapter);
    const files = ['auth.json', 'models_cache.json'].map(file => join(home, file));
    let active = true;
    const refresh = () => {
      void adapter.listModels(provider).catch(() => undefined).then(() => {
        if (active) ctx.emit('llm/models-updated', provider);
      });
    };
    for (const file of files) watchFile(file, { persistent: false, interval: 1000 }, refresh);
    refresh();
    const dispose = () => {
      active = false;
      adapter.dispose();
      for (const file of files) unwatchFile(file, refresh);
      release();
    };
    routes.set(provider, { adapter, account, dispose });
  }

  register('codex', defaultHome);
  ctx.effect(() => () => {
    live = false;
    for (const route of routes.values()) route.dispose();
    routes.clear();
  });

  function reload() {
    const next = updates.then(async () => {
      if (!live) return;
      const credentials = ctx.get('credentials');
      const accounts = readDesktopAccounts(await credentials?.readRecord(desktopAccountsKey));
      if (!live) return;
      const saved = new Map(accounts.map(account => [account.provider, account]));
      for (const [provider, route] of routes) {
        if (!route.account) continue;
        const account = saved.get(provider);
        if (account && account.home === route.account.home && account.identity === route.account.identity && account.label === route.account.label) continue;
        route.dispose();
        routes.delete(provider);
      }
      for (const [provider, account] of saved) {
        if (!routes.has(provider)) register(provider, account.home, account);
      }
    });
    updates = next.catch(() => {});
    return next;
  }

  const refreshAccounts = () => { void reload().catch(() => {}); };
  ctx.inject(['credentials'], refreshAccounts);
  ctx.on('credentials/record-updated', key => {
    if (key === desktopAccountsKey) refreshAccounts();
  });

  ctx.provide('dshCodexAccountUsage', {
    ...applyCodexApi(ctx),
    read: (provider: string, signal: AbortSignal) => routes.get(provider)?.adapter.usage(provider, signal) ?? Promise.resolve(null),
    connected: async () => {
      const connected = await Promise.all([...routes.values()].map(({ adapter }) => adapter.connected()));
      return connected.some(Boolean);
    },
    desktopAccounts: async (signal?: AbortSignal) => {
      signal?.throwIfAborted();
      await reload();
      const [executable, accounts] = await Promise.all([
        findCodexCli(config.codexPath),
        Promise.all([...routes].map(async ([provider, { adapter, account }]) => {
          const signedIn = await adapter.connected();
          const models = signedIn ? await adapter.listModels(provider).catch(() => []) : [];
          return { provider, label: account?.label ?? null, signedIn, modelCount: models.length, removable: !!account };
        })),
      ]);
      signal?.throwIfAborted();
      return { installed: executable !== undefined, canManage: !!ctx.get('credentials'), accounts };
    },
    changeDesktopAccount: async (change: DesktopAccountChange, signal?: AbortSignal): Promise<DesktopAccountResult> => {
      signal?.throwIfAborted();
      const credentials = ctx.get('credentials');
      if (!live || !credentials) return 'unavailable';
      try {
        const result = await updateDesktopAccounts(credentials, defaultHome, change, signal);
        if (result === 'ok') await reload();
        return result;
      } catch {
        signal?.throwIfAborted();
        return 'storage';
      }
    },
  });
}
