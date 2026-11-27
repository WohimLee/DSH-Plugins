import { randomBytes } from 'node:crypto';
import type { Context } from '@deepseek-ai/cordis';
import { credentialKey } from '@deepseek-ai/dsh-credentials';
import type { CredentialProvider, CredentialRecord } from '@deepseek-ai/dsh-credentials';
import { LlmAdapter, LlmError, ReasoningEffortId, attributionHeaders } from '@deepseek-ai/dsh-llm';
import type { GenerateOptions, LlmResolvedModelInfo, PreparedAdapterCall, StreamChunk } from '@deepseek-ai/dsh-llm';
import { fetch as proxyFetch } from 'undici';
import { record } from './local.js';
import { systemProxy } from './proxy.js';
import { buildRequest } from './request.js';
import { httpFailure } from './failure.js';
import { parseStream } from './stream.js';

const API = 'https://api.openai.com/v1';
const apiAccountsKey = credentialKey('dsh-codex', 'api-accounts');
const apiProvider = /^codex-api-account-[0-9a-f]{24}$/;
const codexModel = /^(?:codex-mini-latest|gpt-[0-9][a-z0-9.-]*-codex(?:-[a-z0-9.-]+)?)$/;
const keyFormat = /^[\x21-\x7e]{1,4096}$/;

export type ApiAccountChange = { kind: 'add'; label: string; key: string }
  | { kind: 'remove' | 'refresh'; provider: string };
export type ApiAccountResult = 'ok' | 'unavailable' | 'invalidKey' | 'invalidLabel'
  | 'duplicate' | 'notFound' | 'noModels' | 'network' | 'storage';
type Discovery = { status: 'ok'; models: string[] } | { status: 'invalidKey' | 'noModels' | 'network' };

interface ApiAccount {
  provider: string;
  label: string;
  key: string;
  models: string[];
}

function readAccounts(saved?: CredentialRecord): ApiAccount[] {
  const payload = record(saved?.kind === 'grant' ? saved.payload : undefined);
  if (payload.version !== 1 || !Array.isArray(payload.accounts)) return [];
  return payload.accounts.flatMap(raw => {
    const { provider, label, key, models } = record(raw);
    return typeof provider === 'string' && apiProvider.test(provider)
      && typeof label === 'string' && label.trim() !== '' && label.length <= 80
      && typeof key === 'string' && keyFormat.test(key) && Array.isArray(models)
      ? [{ provider, label, key, models: [...new Set(models.filter(
        (model): model is string => typeof model === 'string' && codexModel.test(model),
      ))] }] : [];
  });
}

async function apiTransport(fetchImpl: typeof fetch, key: string, signal: AbortSignal) {
  const dispatcher = fetchImpl === fetch ? await systemProxy('api.openai.com', signal) : undefined;
  return {
    request(path: '/models' | '/responses', init: { method?: 'POST'; body?: string; headers: Record<string, string> }) {
      const options = { ...init, signal, redirect: 'error' as const, headers: {
        ...attributionHeaders(),
        authorization: `Bearer ${key}`,
        ...init.headers,
      } };
      return dispatcher ? proxyFetch(API + path, { ...options, dispatcher }) : fetchImpl(API + path, options);
    },
    dispose: () => dispatcher?.destroy(),
  };
}

export async function discoverApiModels(key: string, signal: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<Discovery> {
  const timeout = AbortSignal.any([signal, AbortSignal.timeout(15000)]);
  let transport: Awaited<ReturnType<typeof apiTransport>> | undefined;
  try {
    transport = await apiTransport(fetchImpl, key, timeout);
    const response = await transport.request('/models', { headers: { accept: 'application/json' } });
    if (!response.ok) {
      await response.body?.cancel();
      return { status: response.status === 401 || response.status === 403 ? 'invalidKey' : 'network' };
    }
    const { data } = record(await response.json());
    if (!Array.isArray(data)) return { status: 'network' };
    const models = [...new Set(data.flatMap(raw => {
      const { id } = record(raw);
      return typeof id === 'string' && codexModel.test(id) ? [id] : [];
    }))].sort();
    return models.length ? { status: 'ok', models } : { status: 'noModels' };
  } catch {
    signal.throwIfAborted();
    return { status: 'network' };
  } finally {
    await transport?.dispose();
  }
}

const documentedModels = new Set([
  'codex-mini-latest', 'gpt-5-codex', 'gpt-5.1-codex', 'gpt-5.1-codex-max', 'gpt-5.1-codex-mini', 'gpt-5.2-codex', 'gpt-5.3-codex',
]);
const documentedEfforts = new Set(['gpt-5.2-codex', 'gpt-5.3-codex']);

export class CodexApiAdapter extends LlmAdapter {
  private readonly lifetime = new AbortController();

  constructor(private account: ApiAccount, private readonly attachments: () => Context['attachments'] | undefined,
    private readonly fetchImpl: typeof fetch = fetch) {
    super();
  }

  update(account: ApiAccount) { this.account = account; }
  dispose() { this.lifetime.abort(); }

  override providerInfo(provider: string) {
    return { id: provider, name: `Codex · ${this.account.label}` };
  }

  override async listModels(provider: string): Promise<LlmResolvedModelInfo[]> {
    if (provider !== this.account.provider) return [];
    return this.account.models.map(id => {
      const family = id.replace(/-\d{4}-\d{2}-\d{2}$/, '');
      const documented = documentedModels.has(family);
      return {
        provider, id, name: id,
        description: 'OpenAI API model available to the selected API key.',
        inputModalities: documented && this.attachments() ? ['text', 'image'] : ['text'],
        ...(documented && { context: { contextWindow: family === 'codex-mini-latest' ? 200000 : 400000 } }),
        ...(documentedEfforts.has(family) && { reasoning: {
          efforts: ['low', 'medium', 'high', 'xhigh'].map(name => ({ id: ReasoningEffortId(name), name })),
        } }),
      };
    });
  }

  override async resolveModel(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo> {
    signal?.throwIfAborted();
    const selected = (await this.listModels(provider)).find(candidate => candidate.id === model);
    signal?.throwIfAborted();
    if (!selected) throw new LlmError('所选模型不在此 OpenAI API 账号的 Codex 目录中。', 'UNKNOWN_MODEL');
    return selected;
  }

  override async prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<PreparedAdapterCall> {
    return { model: await this.resolveModel(provider, model, signal), stream: options => this.stream(options) };
  }

  override async *stream(options: GenerateOptions): AsyncGenerator<StreamChunk> {
    const signal = options.signal ? AbortSignal.any([this.lifetime.signal, options.signal]) : this.lifetime.signal;
    let transport: Awaited<ReturnType<typeof apiTransport>> | undefined;
    try {
      signal.throwIfAborted();
      const model = await this.resolveModel(options.provider, options.model, signal);
      if (options.reasoningEffort && !model.reasoning?.efforts.some(effort => effort.id === options.reasoningEffort)) {
        throw new LlmError('此 OpenAI API 模型未声明该推理强度。', 'UNSUPPORTED_OPTION');
      }
      const attachments = this.attachments();
      const readImage = model.inputModalities?.includes('image') && attachments
        ? (ref: Parameters<typeof attachments.readImageRequest>[0]) => attachments.readImageRequest(
          ref, this.imageRequestTarget(options.provider, options.model, ref), signal,
        ) : undefined;
      const body = await buildRequest(options, readImage);
      if (options.maxTokens !== undefined) body.max_output_tokens = options.maxTokens;
      const key = this.account.key;
      transport = await apiTransport(this.fetchImpl, key, signal);
      const response = await transport.request('/responses', {
        method: 'POST', headers: { 'content-type': 'application/json', accept: 'text/event-stream' }, body: JSON.stringify(body),
      });
      if (!response.ok) throw await httpFailure(response, 'OpenAI API', [key], signal);
      if (!response.body) throw new LlmError('OpenAI API 没有返回数据流。', 'INVALID_RESPONSE');
      yield* parseStream(response.body, response.headers, 'OpenAI API', [key]);
    } catch (error) {
      const reason = signal.aborted
        ? { kind: 'aborted' as const, failure: { code: 'ABORTED', message: 'OpenAI API 请求已取消。' } }
        : { kind: 'error' as const, failure: error instanceof LlmError ? error.failure
          : { code: 'TRANSPORT', message: 'OpenAI API 网络请求失败。' } };
      yield { type: 'finish', reason };
    } finally {
      await transport?.dispose();
    }
  }
}

async function updateAccounts(store: CredentialProvider, change: ApiAccountChange, signal: AbortSignal,
  fetchImpl: typeof fetch): Promise<ApiAccountResult> {
  if (change.kind === 'add') {
    const label = change.label.trim();
    const key = change.key.trim();
    if (!label || label.length > 80) return 'invalidLabel';
    if (!keyFormat.test(key)) return 'invalidKey';
    const saved = readAccounts(await store.readRecord(apiAccountsKey));
    if (saved.some(account => account.key === key)) return 'duplicate';
    const discovery = await discoverApiModels(key, signal, fetchImpl);
    if (discovery.status !== 'ok') return discovery.status;
    let result: ApiAccountResult = 'duplicate';
    await store.modifyRecord(apiAccountsKey, async current => {
      signal.throwIfAborted();
      const accounts = readAccounts(current);
      if (accounts.some(account => account.key === key)) return;
      const provider = 'codex-api-account-' + randomBytes(12).toString('hex');
      result = 'ok';
      return { kind: 'grant', payload: { version: 1, accounts: [...accounts, { provider, label, key, models: discovery.models }] } };
    });
    return result;
  }

  if (!apiProvider.test(change.provider)) return 'notFound';
  if (change.kind === 'remove') {
    let result: ApiAccountResult = 'notFound';
    await store.modifyRecord(apiAccountsKey, async current => {
      signal.throwIfAborted();
      const accounts = readAccounts(current);
      const remaining = accounts.filter(account => account.provider !== change.provider);
      if (remaining.length === accounts.length) return;
      result = 'ok';
      return { kind: 'grant', payload: { version: 1, accounts: remaining } };
    });
    return result;
  }

  const account = readAccounts(await store.readRecord(apiAccountsKey)).find(item => item.provider === change.provider);
  if (!account) return 'notFound';
  const discovery = await discoverApiModels(account.key, signal, fetchImpl);
  if (discovery.status === 'network') return discovery.status;
  let result: ApiAccountResult = 'notFound';
  await store.modifyRecord(apiAccountsKey, async current => {
    signal.throwIfAborted();
    const accounts = readAccounts(current);
    const index = accounts.findIndex(item => item.provider === account.provider && item.key === account.key);
    if (index < 0) return;
    result = discovery.status;
    accounts[index] = { ...accounts[index], models: discovery.status === 'ok' ? discovery.models : [] };
    return { kind: 'grant', payload: { version: 1, accounts } };
  });
  return result;
}

export function applyCodexApi(ctx: Context, fetchImpl: typeof fetch = fetch) {
  const lifetime = new AbortController();
  const routes = new Map<string, { account: ApiAccount; adapter: CodexApiAdapter; dispose: () => void }>();
  let accounts: ApiAccount[] = [];
  let pending = Promise.resolve();
  let changes = Promise.resolve();
  ctx.effect(() => () => {
    lifetime.abort();
    for (const route of routes.values()) route.dispose();
    routes.clear();
    accounts = [];
  });

  function reload() {
    const next = pending.then(async () => {
      if (lifetime.signal.aborted) return;
      const saved = readAccounts(await ctx.get('credentials')?.readRecord(apiAccountsKey));
      if (lifetime.signal.aborted) return;
      const available = new Map(saved.filter(account => account.models.length > 0).map(account => [account.provider, account]));
      for (const [provider, route] of routes) {
        const account = available.get(provider);
        if (!account || account.key !== route.account.key) {
          route.dispose();
          routes.delete(provider);
        } else if (account.models.join(',') !== route.account.models.join(',')) {
          route.adapter.update(account);
          route.account = account;
          ctx.emit('llm/models-updated', provider);
        }
      }
      accounts = saved;
      for (const [provider, account] of available) {
        if (routes.has(provider)) continue;
        const adapter = new CodexApiAdapter(account, () => ctx.get('attachments'), fetchImpl);
        const release = ctx.llm.registerAdapter([provider], adapter);
        routes.set(provider, { account, adapter, dispose: () => { adapter.dispose(); release(); } });
      }
    });
    pending = next.catch(() => {});
    return next;
  }

  const refresh = () => { void reload().catch(() => {}); };
  ctx.inject(['credentials'], refresh);
  ctx.on('credentials/record-updated', key => {
    if (key === apiAccountsKey) refresh();
  });

  return {
    apiAccounts: async (signal?: AbortSignal) => {
      signal?.throwIfAborted();
      await reload();
      signal?.throwIfAborted();
      return { canManage: !!ctx.get('credentials'), accounts: accounts.map(({ provider, label, models }) => ({
        provider, label, connected: models.length > 0, modelCount: models.length,
      })) };
    },
    changeApiAccount: (change: ApiAccountChange, signal?: AbortSignal): Promise<ApiAccountResult> => {
      const effective = signal ? AbortSignal.any([lifetime.signal, signal]) : lifetime.signal;
      const next = changes.then(async (): Promise<ApiAccountResult> => {
        effective.throwIfAborted();
        const credentials = ctx.get('credentials');
        if (!credentials) return 'unavailable';
        try {
          const result = await updateAccounts(credentials, change, effective, fetchImpl);
          if (result === 'ok' || change.kind === 'refresh' && (result === 'invalidKey' || result === 'noModels')) await reload();
          return result;
        } catch {
          effective.throwIfAborted();
          return 'storage';
        }
      });
      changes = next.then(() => undefined, () => undefined);
      return next;
    },
  };
}
