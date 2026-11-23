import { randomUUID } from 'node:crypto';
import type { Context } from '@deepseek-ai/cordis';
import { credentialKey, credentialKeyId, credentialKeyScope } from '@deepseek-ai/dsh-credentials';
import type {} from '@deepseek-ai/dsh-fs';
import { LlmError, contentHasImage, normalizeApiKey, resolveImageAttachmentAccess, resolveRetryPolicy } from '@deepseek-ai/dsh-llm';
import type { GenerateOptions, LlmModelInfo, LlmResolvedModelInfo, PreparedAdapterCall, StreamChunk } from '@deepseek-ai/dsh-llm';
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai';
import type { ResolvedPiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai';
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import type {} from '@deepseek-ai/dsh-typert-registry';
import { defaultProviderAuthContext, InMemoryCredentialStore } from '@earendil-works/pi-ai';
import type { GrokModel } from './catalog.js';
import { grokProvider, readCatalog, RejectedKey, route } from './catalog.js';
import { change, contribution, defaultAccountId, service } from './remote.js';
import type { AccountView, Change, ConnectionView } from './remote.js';

export const name = 'dsh-grok';
export const inject = ['llm', 'credentials'];
const storedAccountPattern = /^account-([\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12})$/i;
const accountRoute = (id: string) => id === defaultAccountId ? route : `grok-account-${id}`;
const keyRecord = (id: string) => credentialKey(name, id === defaultAccountId ? 'api-key' : `account-${id}`);

async function* safeStream(
  start: (options: GenerateOptions) => AsyncIterable<StreamChunk>,
  options: GenerateOptions,
  connection: AbortSignal,
  acceptsImages: boolean,
): AsyncGenerator<StreamChunk> {
  const signal = options.signal ? AbortSignal.any([connection, options.signal]) : connection;
  signal.throwIfAborted();
  if (!acceptsImages && options.messages.some(message => contentHasImage(message.content))) {
    throw new LlmError('此 Grok 路由当前无法接收图片，请检查模型目录及宿主附件服务。', 'UNSUPPORTED_CONTENT');
  }
  for await (const chunk of start({ ...options, signal })) {
    if (chunk.type === 'finish' && chunk.reason.kind === 'error') {
      const { code } = chunk.reason.failure;
      // Remote diagnostics may contain portions of requests, including credentials.
      yield { type: 'finish', reason: { kind: 'error', failure: { code, message: `Grok request failed (${code}).` } } };
    } else if (chunk.type === 'finish' && chunk.reason.kind === 'aborted') {
      yield { type: 'finish', reason: { kind: 'aborted', failure: { code: 'ABORTED', message: 'Grok request was cancelled.' } } };
    } else {
      yield chunk;
    }
  }
}

export class GrokAdapter extends PiAiAdapter {
  private readonly hasAttachments: () => boolean;
  constructor(
    private readonly catalog: (provider: string) => readonly GrokModel[],
    private readonly connectionSignal: (provider: string) => AbortSignal,
    options: ConstructorParameters<typeof PiAiAdapter>[0],
  ) {
    super(options);
    this.hasAttachments = () => typeof options.resolveAttachments?.()?.readImageRequest === 'function';
  }

  private inputInfo(model: GrokModel, attachments: boolean): Pick<LlmModelInfo, 'inputModalities' | 'description'> {
    const image = attachments && model.input.includes('image');
    const missing = model.input.includes('image') && !attachments;
    return {
      inputModalities: image ? ['text', 'image'] : ['text'],
      description: model.capabilityDescription + (missing ? '。宿主附件服务不可用，当前仅接收文本' : ''),
    };
  }

  override async listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    const attachments = this.hasAttachments();
    return this.catalog(provider).map(model => ({
      provider, id: model.id, name: model.name, ...this.inputInfo(model, attachments),
    }));
  }

  private withCapabilities(model: LlmResolvedModelInfo, catalog: readonly GrokModel[]): LlmResolvedModelInfo {
    const entry = catalog.find(entry => entry.id === model.id);
    if (!entry) return model;
    const { inputModalities, description } = this.inputInfo(entry, this.hasAttachments());
    return { ...model, inputModalities, description,
      ...(entry.defaultEffort && model.reasoning && { reasoning: { ...model.reasoning, defaultEffort: entry.defaultEffort } }),
    };
  }

  override async resolveModel(provider: string, model: string, signal?: AbortSignal) {
    const catalog = this.catalog(provider);
    return this.withCapabilities((await super.prepareCall(provider, model, signal)).model, catalog);
  }

  override stream(options: GenerateOptions) {
    return safeStream(request => super.stream(request), options, this.connectionSignal(options.provider), this.hasAttachments());
  }

  override async prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<PreparedAdapterCall> {
    const connection = this.connectionSignal(provider);
    const catalog = this.catalog(provider);
    const prepared = await super.prepareCall(provider, model, signal);
    const resolved = this.withCapabilities(prepared.model, catalog);
    return {
      model: resolved,
      stream: options => safeStream(prepared.stream, options, connection,
        !!resolved.inputModalities?.includes('image') && this.hasAttachments()),
    };
  }
}

class ConnectionRemote extends TypertRemoteService {
  constructor(
    ctx: Context,
    private readonly status: (refresh: boolean) => Promise<ConnectionView>,
    private readonly applyChange: (input: Change) => Promise<ConnectionView>,
  ) {
    super(ctx, service);
    ctx.effect(() => ctx.typert.register({
      package: name, face: 'host', schemas: [], invocations: contribution.descriptors,
      model: { services: [], events: [], objects: [] },
    }));
  }

  @Remote
  async read(refresh: boolean) {
    if (this.ctx.invocation?.peer.principal.kind !== 'owner') return null;
    return this.status(refresh);
  }

  @Remote
  async update(input: unknown) {
    if (this.ctx.invocation?.peer.principal.kind !== 'owner') return null;
    return this.applyChange(change.parse(input));
  }
}

type ActiveAccount = {
  key: string;
  models: readonly GrokModel[];
  connection: AbortController;
  profile: ResolvedPiAiProviderProfile;
};

export function apply(ctx: Context): void {
  const lifetime = new AbortController();
  let accounts = new Map<string, AccountView>();
  let active = new Map<string, ActiveAccount>();
  let profiles = new Map<string, ResolvedPiAiProviderProfile>();
  const keys = new WeakMap<ResolvedPiAiProviderProfile, string>();
  let registration: ReturnType<Context['llm']['registerAdapter']> | undefined;
  const adapter = new GrokAdapter(
    provider => active.get(provider)?.models ?? [],
    provider => active.get(provider)?.connection.signal ?? lifetime.signal,
    {
      profiles: () => profiles,
      resolveApiKey: async (_route, profile) => {
        const key = keys.get(profile);
        if (!key) throw new LlmError('Grok is disconnected.', 'MISSING_CREDENTIAL');
        return key;
      },
      auth: { credentials: new InMemoryCredentialStore(), authContext: defaultProviderAuthContext() },
      resolveAttachments: () => ctx.get('attachments'),
      resolveImageAccess: (attachments, ref) => resolveImageAttachmentAccess(
        attachments, path => ctx.get('fs')?.processPathFromHostPath(path), ref,
      ),
    },
  );
  ctx.effect(() => () => {
    lifetime.abort();
    for (const account of active.values()) {
      account.connection.abort();
      keys.delete(account.profile);
    }
    accounts.clear();
    active.clear();
    profiles = new Map();
  });

  function view(error?: ConnectionView['error']): ConnectionView {
    const entries = [...accounts.values()];
    return {
      state: active.size ? 'connected' : entries[0]?.state ?? 'unbound',
      modelCount: new Set([...active.values()].flatMap(account => account.models.map(model => model.id))).size,
      accounts: entries,
      ...(error && { error }),
    };
  }

  function connectAccount(id: string, label: string | undefined, key: string, models: readonly GrokModel[]): ActiveAccount {
    const provider = accountRoute(id);
    const previous = active.get(provider);
    const profile: ResolvedPiAiProviderProfile = {
      provider, displayName: label ? `Grok · ${label}` : 'Grok', piProvider: grokProvider(models, provider),
      modelErrors: new Map(), configuredMaxTokens: new Map(),
      retryPolicy: resolveRetryPolicy(undefined, 'grok.retryPolicy'),
      streamIdleTimeoutMs: 300_000,
      maxRequestImageBytes: 20 * 1024 * 1024, maxRequestImages: 50, imageOffloadCountQuantum: 10,
      requestImagePixelBudget: 4_194_304, requestImageMaxBytes: 2 * 1024 * 1024,
    };
    keys.set(profile, key);
    return { key, models, profile, connection: previous?.key === key ? previous.connection : new AbortController() };
  }

  function publish(nextAccounts: Map<string, AccountView>, nextActive: Map<string, ActiveAccount>): ConnectionView {
    lifetime.signal.throwIfAborted();
    const previous = active;
    const previousProfiles = profiles;
    active = nextActive;
    profiles = new Map([...nextActive].map(([provider, account]) => [provider, account.profile]));
    try {
      if (!registration && active.size) registration = ctx.llm.registerAdapter([...active.keys()], adapter);
      else if (active.size !== previous.size || [...active.keys()].some(provider => !previous.has(provider))) {
        registration?.replace([...active.keys()]);
      }
    } catch (error) {
      active = previous;
      profiles = previousProfiles;
      for (const [provider, account] of nextActive) {
        if (account.connection !== previous.get(provider)?.connection) account.connection.abort();
      }
      throw error;
    }
    accounts = nextAccounts;
    for (const [provider, account] of previous) {
      const next = active.get(provider);
      if (account.connection !== next?.connection) {
        account.connection.abort();
        keys.delete(account.profile);
      }
      if (next && account !== next) ctx.emit('llm/models-updated', provider);
    }
    return view();
  }

  async function probe(key: string) {
    try {
      const models = await readCatalog(key, lifetime.signal);
      return { status: models.length ? 'connected' as const : 'empty' as const, models };
    } catch (error) {
      return { status: error instanceof RejectedKey ? 'unauthorized' as const : 'unavailable' as const, models: [] };
    }
  }

  let pending: Promise<unknown> = Promise.resolve();
  function enqueue(operation: () => Promise<ConnectionView>): Promise<ConnectionView> {
    const result = pending.then(() => {
      lifetime.signal.throwIfAborted();
      return operation();
    });
    pending = result.catch(() => {});
    return result;
  }

  async function loadAccount(id: string) {
    const record = await ctx.credentials.readRecord(keyRecord(id));
    if (!record) return;
    const payload = record.kind === 'grant' ? record.payload : undefined;
    let label = id === defaultAccountId ? undefined : `Account ${id.slice(-6)}`;
    let secret: unknown = id === defaultAccountId ? payload : undefined;
    if (id !== defaultAccountId && payload && typeof payload === 'object' && 'version' in payload
      && payload.version === 1 && 'label' in payload && 'key' in payload && typeof payload.label === 'string'
      && payload.label.trim() && payload.label.length <= 80) {
      label = payload.label;
      secret = payload.key;
    }
    const key = typeof secret === 'string' ? normalizeApiKey(secret) : null;
    if (!key?.ok) return { account: { id, label, state: 'unauthorized', modelCount: 0 } satisfies AccountView };

    const result = await probe(key.value);
    const previous = active.get(accountRoute(id));
    // A transient catalog failure does not invalidate a previously validated credential.
    const connection = result.status === 'connected' ? connectAccount(id, label, key.value, result.models)
      : result.status === 'unavailable' && previous?.key === key.value ? previous : undefined;
    return {
      account: { id, label, state: connection ? 'connected' : result.status, modelCount: connection?.models.length ?? 0 },
      connection,
    };
  }

  async function reload(): Promise<ConnectionView> {
    try {
      const records = await ctx.credentials.listRecords();
      const ids = records.flatMap(entry => {
        if (credentialKeyScope(entry.key) !== name) return [];
        const id = storedAccountPattern.exec(credentialKeyId(entry.key))?.[1];
        return id ? [id] : [];
      });
      const loaded = await Promise.all([defaultAccountId, ...ids].map(loadAccount));
      const nextAccounts = new Map<string, AccountView>();
      const nextActive = new Map<string, ActiveAccount>();
      for (const item of loaded) {
        if (!item) continue;
        nextAccounts.set(item.account.id, item.account);
        if (item.connection) nextActive.set(accountRoute(item.account.id), item.connection);
      }
      return publish(nextAccounts, nextActive);
    } catch {
      return view('storage');
    }
  }

  async function update(input: Change): Promise<ConnectionView> {
    const id = input.kind === 'add' ? randomUUID() : input.kind === 'connect' ? defaultAccountId
      : input.id ?? defaultAccountId;
    const provider = accountRoute(id);
    const nextAccounts = new Map(accounts);
    const nextActive = new Map(active);
    if (input.kind === 'disconnect') {
      try { await ctx.credentials.deleteRecord(keyRecord(id)); }
      catch { return view('storage'); }
      nextAccounts.delete(id);
      nextActive.delete(provider);
      return publish(nextAccounts, nextActive);
    }
    const key = normalizeApiKey(input.key);
    if (!key.ok) return view('unauthorized');
    const result = await probe(key.value);
    lifetime.signal.throwIfAborted();
    if (result.status !== 'connected') return view(result.status);
    const label = input.kind === 'add' ? input.label : accounts.get(id)?.label;
    try {
      await ctx.credentials.modifyRecord(keyRecord(id), async current => {
        if ((input.kind === 'replace' && !current) || (input.kind === 'add' && current)) {
          throw new Error('Grok account record changed');
        }
        return {
          kind: 'grant',
          payload: id === defaultAccountId ? key.value : { version: 1, label: label ?? `Account ${id.slice(-6)}`, key: key.value },
        };
      });
    } catch { return view('storage'); }
    nextAccounts.set(id, { id, label, state: 'connected', modelCount: result.models.length });
    nextActive.set(provider, connectAccount(id, label, key.value, result.models));
    return publish(nextAccounts, nextActive);
  }

  ctx.inject(['attachments'], child => {
    const refresh = () => {
      if (lifetime.signal.aborted) return;
      for (const provider of active.keys()) ctx.emit('llm/models-updated', provider);
    };
    refresh();
    child.effect(() => refresh);
  });
  void enqueue(reload).catch(() => {});
  ctx.inject(['typert'], child => {
    new ConnectionRemote(child, refresh => enqueue(refresh ? reload : async () => view()), input => enqueue(() => update(input)));
  });
}
