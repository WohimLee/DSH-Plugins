import { randomUUID } from 'node:crypto';
import type { Context } from '@deepseek-ai/cordis';
import { getOrCreateAnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id';
import { credentialKey, credentialKeyId, credentialKeyScope } from '@deepseek-ai/dsh-credentials';
import type { CredentialKey, CredentialRecord } from '@deepseek-ai/dsh-credentials';
import { APP_IDENTITY, LlmError, normalizeApiKey, resolveImageAttachmentAccess } from '@deepseek-ai/dsh-llm';
import type { GenerateOptions } from '@deepseek-ai/dsh-llm';
import {
  DeepSeekAdapter, PUBLIC_BASE_URL, catalogModelInfo, modelListingURL, requestModelListing,
  resolveAdapterOptions, resolveListedCatalog,
} from '@deepseek-ai/dsh-llm-deepseek';
import type { DeepSeekConnectionOptions, ListedCatalog } from '@deepseek-ai/dsh-llm-deepseek';
import { z } from 'zod';

const scope = 'dsh-model-picker';
const prefix = 'deepseek-api-account-';
const accountRoute = /^deepseek-api-account-[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/;
const defaults = resolveAdapterOptions({ baseURL: PUBLIC_BASE_URL });
const stored = z.object({
  version: z.literal(1),
  label: z.string().trim().min(1).max(80),
  key: z.string().max(8192),
});
type Credentials = z.infer<typeof stored>;
export type DeepSeekApiChange =
  | { kind: 'add'; label: string; key: string }
  | { kind: 'remove' | 'refresh'; provider: string };
export type DeepSeekApiResult =
  | 'ok' | 'unavailable' | 'invalidKey' | 'invalidLabel' | 'duplicate'
  | 'notFound' | 'noModels' | 'network' | 'storage';

type Connection = DeepSeekConnectionOptions & {
  key: string;
  catalog: ListedCatalog;
};
type Account = {
  label: string;
  catalog?: ListedCatalog;
  disconnect?: () => void;
  update?: (credentials: Credentials, catalog: ListedCatalog) => void;
};
type Probe = { result: 'ok'; catalog: ListedCatalog } | {
  result: 'invalidKey' | 'noModels' | 'network';
};

function readRecord(record: CredentialRecord | null | undefined): Credentials | undefined {
  if (record?.kind !== 'grant') return;
  const parsed = stored.safeParse(record.payload);
  return parsed.success ? parsed.data : undefined;
}

class ScopedDeepSeekAdapter extends DeepSeekAdapter<Connection> {
  constructor(
    dependencies: ConstructorParameters<typeof DeepSeekAdapter<Connection>>[0],
    private readonly lifetime: AbortSignal,
  ) {
    super(dependencies);
  }

  override async prepareCall(provider: string, model: string, signal?: AbortSignal) {
    const active = this.signal(signal);
    active.throwIfAborted();
    const prepared = await super.prepareCall(provider, model, active);
    return { ...prepared, stream: (options: GenerateOptions) => prepared.stream({ ...options, signal: this.signal(options.signal) }) };
  }

  override stream(options: GenerateOptions<string>) {
    return super.stream({ ...options, signal: this.signal(options.signal) });
  }

  private signal(signal?: AbortSignal) {
    return signal ? AbortSignal.any([signal, this.lifetime]) : this.lifetime;
  }
}

export function createDeepSeekApi(ctx: Context) {
  const lifetime = new AbortController();
  const accounts = new Map<string, Account>();
  const revisions = new Map<string, number>();
  const ownWrites = new Set<CredentialKey>();
  let userId: ReturnType<typeof getOrCreateAnonymousUserId> | undefined;

  ctx.effect(() => () => {
    lifetime.abort();
    for (const account of accounts.values()) account.disconnect?.();
    accounts.clear();
  });

  function activate(provider: string, credentials: Credentials, catalog: ListedCatalog) {
    lifetime.signal.throwIfAborted();
    const previous = accounts.get(provider);
    if (previous?.update) {
      previous.update(credentials, catalog);
      accounts.set(provider, { ...previous, label: credentials.label, catalog });
      ctx.emit('llm/models-updated', provider);
      return;
    }
    const controller = new AbortController();
    let connection: Connection = { ...defaults, models: catalog.offered, key: credentials.key, catalog };
    const adapter = new ScopedDeepSeekAdapter({
      providerName: `DeepSeek · ${credentials.label}`,
      options: () => connection,
      admit: (connection, model) => {
        if (!connection.catalog.offered.some(entry => entry.id === model)) {
          throw new LlmError('This model is unavailable for the selected DeepSeek API account.', 'UNKNOWN_MODEL');
        }
      },
      discoverModels: async () => connection.catalog.offered
        .map(model => catalogModelInfo(provider, model, connection.catalog.badges.get(model.id))),
      resolveAuth: async current => ({ headers: { 'x-api-key': current.key } }),
      resolveUserId: () => userId ??= getOrCreateAnonymousUserId(),
      resolveAttachments: () => ctx.get('attachments'),
      resolveImageAccess: (attachments, ref) => resolveImageAttachmentAccess(
        attachments, path => ctx.get('fs')?.processPathFromHostPath(path), ref,
      ),
      prepareExtensions: request => ctx.get('deepseekLlmApiExtensions')?.prepare(request)
        ?? Promise.resolve({ fields: {}, accept: () => Promise.resolve() }),
    }, AbortSignal.any([lifetime.signal, controller.signal]));
    const registration = ctx.llm.registerAdapter([provider], adapter);
    accounts.set(provider, {
      label: credentials.label, catalog,
      disconnect: () => { controller.abort(); registration(); },
      update: (latest, catalog) => { connection = { ...defaults, models: catalog.offered, key: latest.key, catalog }; },
    });
  }

  async function probe(key: string, signal: AbortSignal): Promise<Probe> {
    try {
      const listing = await requestModelListing(modelListingURL(PUBLIC_BASE_URL), { 'x-api-key': key },
        AbortSignal.any([signal, AbortSignal.timeout(10_000)]));
      const catalog = resolveListedCatalog({
        listing: listing.entries, supported: defaults.models, overrides: {},
        routeMaxTokens: defaults.maxTokens, clientVersion: APP_IDENTITY.version,
      });
      return catalog.offered.length ? { result: 'ok', catalog } : { result: 'noModels' };
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof LlmError && (error.code === 'HTTP_401' || error.code === 'HTTP_403')) {
        return { result: 'invalidKey' };
      }
      return { result: 'network' };
    }
  }

  function revision(provider: string) {
    return revisions.get(provider) ?? 0;
  }

  async function refresh(provider: string, credentials: Credentials, signal: AbortSignal,
    expected = revision(provider)): Promise<DeepSeekApiResult> {
    if (expected !== revision(provider)) return 'unavailable';
    const response = await probe(credentials.key, signal);
    signal.throwIfAborted();
    if (expected !== revision(provider)) return 'unavailable';
    if (response.result === 'ok') {
      activate(provider, credentials, response.catalog);
    } else if (response.result !== 'network' || !accounts.get(provider)?.catalog) {
      accounts.get(provider)?.disconnect?.();
      accounts.set(provider, { label: credentials.label });
    }
    return response.result;
  }

  async function load() {
    const records = await ctx.credentials.listRecords();
    await Promise.allSettled(records.flatMap(entry => {
      if (credentialKeyScope(entry.key) !== scope) return [];
      const provider = credentialKeyId(entry.key);
      if (!accountRoute.test(provider)) return [];
      const expected = revision(provider);
      return [ctx.credentials.readRecord(entry.key).then(record => {
        const value = readRecord(record);
        return value && refresh(provider, value, lifetime.signal, expected);
      })];
    }));
  }

  let pending: Promise<unknown> = load().catch(() => {});
  function enqueue(operation: () => Promise<DeepSeekApiResult>): Promise<DeepSeekApiResult> {
    const task = pending.then(operation);
    pending = task.catch(() => {});
    return task;
  }
  async function write<T>(key: CredentialKey, operation: () => Promise<T>): Promise<T> {
    ownWrites.add(key);
    try { return await operation(); } finally { ownWrites.delete(key); }
  }

  ctx.on('credentials/record-updated', key => {
    if (lifetime.signal.aborted || ownWrites.has(key) || credentialKeyScope(key) !== scope) return;
    const provider = credentialKeyId(key);
    if (!accountRoute.test(provider)) return;
    const expected = revision(provider) + 1;
    revisions.set(provider, expected);
    const previous = accounts.get(provider);
    previous?.disconnect?.();
    if (previous) accounts.set(provider, { label: previous.label });
    void enqueue(async () => {
      if (expected !== revision(provider)) return 'unavailable';
      const credentials = readRecord(await ctx.credentials.readRecord(key));
      if (expected !== revision(provider)) return 'unavailable';
      if (credentials) return refresh(provider, credentials, lifetime.signal, expected);
      accounts.delete(provider);
      return 'notFound';
    }).catch(() => {});
  });

  async function change(change: DeepSeekApiChange, signal: AbortSignal): Promise<DeepSeekApiResult> {
    signal.throwIfAborted();
    if (change.kind !== 'add') {
      if (!accountRoute.test(change.provider)) return 'notFound';
      const storageKey = credentialKey(scope, change.provider);
      if (change.kind === 'refresh') {
        const expected = revision(change.provider);
        const record = readRecord(await ctx.credentials.readRecord(storageKey));
        return record ? refresh(change.provider, record, signal, expected) : 'notFound';
      }
      if (!accounts.has(change.provider)) return 'notFound';
      await write(storageKey, () => ctx.credentials.deleteRecord(storageKey));
      accounts.get(change.provider)?.disconnect?.();
      accounts.delete(change.provider);
      return 'ok';
    }

    const label = change.label.trim();
    if (!label || label.length > 80) return 'invalidLabel';
    if ([...accounts.values()].some(account => account.label === label)) return 'duplicate';
    const normalized = normalizeApiKey(change.key);
    if (!normalized.ok || normalized.value.length > 8192) return 'invalidKey';
    const response = await probe(normalized.value, signal);
    if (response.result !== 'ok') return response.result;
    signal.throwIfAborted();
    const provider = prefix + randomUUID();
    const storageKey = credentialKey(scope, provider);
    const credentials: Credentials = { version: 1, label, key: normalized.value };
    await write(storageKey, () => ctx.credentials.modifyRecord(storageKey, async previous => {
      if (previous) throw new Error('DeepSeek API account already exists');
      return { kind: 'grant', payload: credentials };
    }));
    try {
      activate(provider, credentials, response.catalog);
    } catch (error) {
      await write(storageKey, () => ctx.credentials.deleteRecord(storageKey));
      throw error;
    }
    return 'ok';
  }

  return {
    async readUsage(provider: string, signal: AbortSignal) {
      if (!accountRoute.test(provider) || !accounts.get(provider)?.catalog) return null;
      const active = AbortSignal.any([signal, lifetime.signal, AbortSignal.timeout(10_000)]);
      const record = readRecord(await ctx.credentials.readRecord(credentialKey(scope, provider)));
      if (!record) return null;
      const response = await fetch(new URL('/user/balance', PUBLIC_BASE_URL), {
        headers: { Authorization: `Bearer ${record.key}` }, signal: active, redirect: 'error',
      });
      if (!response.ok) return null;
      const parsed = z.object({ balance_infos: z.array(z.object({
        currency: z.string(), total_balance: z.string(), granted_balance: z.string(),
      })) }).safeParse(await response.json());
      if (!parsed.success) return null;
      return {
        wallets: parsed.data.balance_infos.map(info => ({ currency: info.currency, balance: info.total_balance })),
        bonus: parsed.data.balance_infos.map(info => ({ currency: info.currency, balance: info.granted_balance })),
      };
    },
    async apiAccounts() {
      await pending;
      return {
        canManage: true,
        accounts: [...accounts]
          .sort(([left, a], [right, b]) => a.label.localeCompare(b.label) || left.localeCompare(right))
          .map(([provider, account]) => ({
            provider, label: account.label, connected: !!account.catalog, modelCount: account.catalog?.offered.length ?? 0,
          })),
      };
    },
    changeApiAccount(input: DeepSeekApiChange, signal?: AbortSignal): Promise<DeepSeekApiResult> {
      const active = signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal;
      return enqueue(() => change(input, active)).catch(() => {
        active.throwIfAborted();
        return 'storage';
      });
    },
  };
}
