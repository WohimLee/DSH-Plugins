import type { Context } from '@deepseek-ai/cordis';
import { credentialKey } from '@deepseek-ai/dsh-credentials';
import type {} from '@deepseek-ai/dsh-fs';
import { LlmError, normalizeApiKey, resolveImageAttachmentAccess, resolveRetryPolicy } from '@deepseek-ai/dsh-llm';
import type { GenerateOptions, LlmResolvedModelInfo, PreparedAdapterCall, StreamChunk } from '@deepseek-ai/dsh-llm';
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai';
import type { ResolvedPiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai';
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import type {} from '@deepseek-ai/dsh-typert-registry';
import { defaultProviderAuthContext, InMemoryCredentialStore } from '@earendil-works/pi-ai';
import type { GrokModel } from './catalog.js';
import { grokProvider, readCatalog, RejectedKey, route } from './catalog.js';
import { change, contribution, service } from './remote.js';
import type { Change, ConnectionView } from './remote.js';

export const name = 'dsh-grok';
export const inject = ['llm', 'credentials'];
const keyRecord = credentialKey(name, 'api-key');

async function* safeStream(
  start: (options: GenerateOptions) => AsyncIterable<StreamChunk>,
  options: GenerateOptions,
  connection: AbortSignal,
): AsyncGenerator<StreamChunk> {
  const signal = options.signal ? AbortSignal.any([connection, options.signal]) : connection;
  signal.throwIfAborted();
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

class GrokAdapter extends PiAiAdapter {
  constructor(
    private readonly catalog: () => readonly GrokModel[],
    private readonly connectionSignal: () => AbortSignal,
    options: ConstructorParameters<typeof PiAiAdapter>[0],
  ) {
    super(options);
  }

  private withDefault(model: LlmResolvedModelInfo, catalog: readonly GrokModel[]): LlmResolvedModelInfo {
    const defaultEffort = catalog.find(entry => entry.id === model.id)?.defaultEffort;
    return defaultEffort && model.reasoning
      ? { ...model, reasoning: { ...model.reasoning, defaultEffort } } : model;
  }

  override async resolveModel(provider: string, model: string, signal?: AbortSignal) {
    const catalog = this.catalog();
    return this.withDefault(await super.resolveModel(provider, model, signal), catalog);
  }

  override stream(options: GenerateOptions) {
    return safeStream(request => super.stream(request), options, this.connectionSignal());
  }

  override async prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<PreparedAdapterCall> {
    const connection = this.connectionSignal();
    const catalog = this.catalog();
    const prepared = await super.prepareCall(provider, model, signal);
    return {
      model: this.withDefault(prepared.model, catalog),
      stream: options => safeStream(prepared.stream, options, connection),
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

export function apply(ctx: Context): void {
  const lifetime = new AbortController();
  let connection = new AbortController();
  let state: ConnectionView = { state: 'unbound', modelCount: 0 };
  let profiles = new Map<string, ResolvedPiAiProviderProfile>();
  const keys = new WeakMap<ResolvedPiAiProviderProfile, string>();
  let keyInUse: string | undefined;
  let registration: ReturnType<Context['llm']['registerAdapter']> | undefined;
  let catalog: readonly GrokModel[] = [];
  const adapter = new GrokAdapter(() => catalog, () => connection.signal, {
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
  });
  ctx.effect(() => () => {
    lifetime.abort();
    connection.abort();
    const profile = profiles.get(route);
    if (profile) keys.delete(profile);
    keyInUse = undefined;
    profiles = new Map();
  });

  function publish(next: ConnectionView, models: Awaited<ReturnType<typeof readCatalog>> = [], key?: string): ConnectionView {
    lifetime.signal.throwIfAborted();
    const previous = profiles.get(route);
    if (keyInUse !== key) {
      connection.abort();
      connection = new AbortController();
      if (previous) keys.delete(previous);
    }
    keyInUse = key;
    catalog = models;
    if (key) {
      const profile: ResolvedPiAiProviderProfile = {
        provider: route, displayName: 'Grok', piProvider: grokProvider(models),
        modelErrors: new Map(), configuredMaxTokens: new Map(),
        retryPolicy: resolveRetryPolicy(undefined, 'grok.retryPolicy'),
        streamIdleTimeoutMs: 300_000,
        maxRequestImageBytes: 20 * 1024 * 1024, maxRequestImages: 50, imageOffloadCountQuantum: 10,
        requestImagePixelBudget: 4_194_304, requestImageMaxBytes: 2 * 1024 * 1024,
      };
      keys.set(profile, key);
      profiles = new Map([[route, profile]]);
      try {
        if (!registration) registration = ctx.llm.registerAdapter([route], adapter);
        else if (!previous) registration.replace([route]);
      } catch (error) {
        profiles = new Map();
        keys.delete(profile);
        keyInUse = undefined;
        connection.abort();
        throw error;
      }
      if (previous) ctx.emit('llm/models-updated', route);
    } else if (previous) {
      profiles = new Map();
      registration?.replace([]);
    }
    state = next;
    return state;
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

  async function reload(): Promise<ConnectionView> {
    try {
      const stored = await ctx.credentials.readRecord(keyRecord);
      if (!stored) return publish({ state: 'unbound', modelCount: 0 });
      const key = stored.kind === 'grant' && typeof stored.payload === 'string' ? normalizeApiKey(stored.payload) : null;
      if (!key?.ok) return publish({ state: 'unauthorized', modelCount: 0 });
      const result = await probe(key.value);
      return publish({ state: result.status, modelCount: result.models.length }, result.models,
        result.status === 'connected' ? key.value : undefined);
    } catch {
      return publish({ state: 'unavailable', modelCount: 0, error: 'storage' });
    }
  }

  async function update(input: Change): Promise<ConnectionView> {
    if (input.kind === 'disconnect') {
      try { await ctx.credentials.deleteRecord(keyRecord); }
      catch { return { ...state, error: 'storage' }; }
      return publish({ state: 'unbound', modelCount: 0 });
    }
    const key = normalizeApiKey(input.key);
    if (!key.ok) return { ...state, error: 'unauthorized' };
    const result = await probe(key.value);
    lifetime.signal.throwIfAborted();
    if (result.status !== 'connected') return { ...state, error: result.status };
    try { await ctx.credentials.modifyRecord(keyRecord, async () => ({ kind: 'grant', payload: key.value })); }
    catch { return { ...state, error: 'storage' }; }
    return publish({ state: 'connected', modelCount: result.models.length }, result.models, key.value);
  }

  void enqueue(reload).catch(() => {});
  ctx.inject(['typert'], child => {
    new ConnectionRemote(child, refresh => enqueue(refresh ? reload : async () => state), input => enqueue(() => update(input)));
  });
}
