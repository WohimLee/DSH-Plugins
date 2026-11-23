import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-typert-registry';
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { createDeepSeekApi } from './deepseek-api.js';
import { codexApi, codexDesktop, contribution, service, usage } from './remote.js';
import type {
  CodexAccountChange, CodexAccountResult, CodexApi, CodexApiChange, CodexApiResult, CodexDesktop, ProviderUsage, UsageProvider,
} from './remote.js';

export const name = 'dsh-model-picker';
export const inject = ['typert'];

declare module '@deepseek-ai/cordis' {
  interface Context {
    dshCodexAccountUsage: UsageProvider & {
      connected?: () => Promise<boolean>;
      desktopAccounts?: (signal?: AbortSignal) => Promise<CodexDesktop>;
      changeDesktopAccount?: (change: CodexAccountChange, signal?: AbortSignal) => Promise<CodexAccountResult>;
      apiAccounts?: (signal?: AbortSignal) => Promise<CodexApi>;
      changeApiAccount?: (change: CodexApiChange, signal?: AbortSignal) => Promise<CodexApiResult>;
    };
    dshQoderAccountUsage: UsageProvider;
  }
}

class Usage extends TypertRemoteService {
  deepSeek?: ReturnType<typeof createDeepSeekApi>;

  constructor(ctx: Context) {
    super(ctx, service);
    ctx.effect(() => ctx.typert.register({
      package: name, face: 'host', schemas: [], invocations: contribution.descriptors,
      model: { services: [], events: [], objects: [] },
    }));
  }

  @Remote
  async codexConnection(): Promise<boolean | null> {
    if (this.ctx.invocation?.peer.principal.kind !== 'owner') return null;
    return await this.ctx.get('dshCodexAccountUsage')?.connected?.() ?? null;
  }

  @Remote
  async codexDesktop(signal: AbortSignal): Promise<CodexDesktop | null> {
    if (this.ctx.invocation?.peer.principal.kind !== 'owner') return null;
    signal.throwIfAborted();
    const value = await this.ctx.get('dshCodexAccountUsage')?.desktopAccounts?.(signal);
    const parsed = codexDesktop.safeParse(value);
    return parsed.success ? parsed.data : null;
  }

  @Remote
  async changeCodexDesktop(change: CodexAccountChange, signal: AbortSignal): Promise<CodexAccountResult> {
    if (this.ctx.invocation?.peer.principal.kind !== 'owner') return 'unavailable';
    signal.throwIfAborted();
    return await this.ctx.get('dshCodexAccountUsage')?.changeDesktopAccount?.(change, signal) ?? 'unavailable';
  }

  @Remote
  async codexApi(signal: AbortSignal): Promise<CodexApi | null> {
    if (this.ctx.invocation?.peer.principal.kind !== 'owner') return null;
    signal.throwIfAborted();
    const parsed = codexApi.safeParse(await this.ctx.get('dshCodexAccountUsage')?.apiAccounts?.(signal));
    return parsed.success ? parsed.data : null;
  }

  @Remote
  async changeCodexApi(change: CodexApiChange, signal: AbortSignal): Promise<CodexApiResult> {
    if (this.ctx.invocation?.peer.principal.kind !== 'owner') return 'unavailable';
    signal.throwIfAborted();
    return await this.ctx.get('dshCodexAccountUsage')?.changeApiAccount?.(change, signal) ?? 'unavailable';
  }

  @Remote
  async deepSeekApi(signal: AbortSignal): Promise<CodexApi | null> {
    if (this.ctx.invocation?.peer.principal.kind !== 'owner') return null;
    signal.throwIfAborted();
    const parsed = codexApi.safeParse(await this.deepSeek?.apiAccounts());
    signal.throwIfAborted();
    return parsed.success ? parsed.data : null;
  }

  @Remote
  async changeDeepSeekApi(change: CodexApiChange, signal: AbortSignal): Promise<CodexApiResult> {
    if (this.ctx.invocation?.peer.principal.kind !== 'owner') return 'unavailable';
    signal.throwIfAborted();
    return await this.deepSeek?.changeApiAccount(change, signal) ?? 'unavailable';
  }

  @Remote
  async read(provider: string, signal: AbortSignal): Promise<ProviderUsage | null> {
    if (this.ctx.invocation?.peer.principal.kind !== 'owner') return null;
    signal.throwIfAborted();
    const source = provider === 'codex' || provider.startsWith('codex-account-') ? this.ctx.get('dshCodexAccountUsage')
      : provider === 'qoder' || provider.startsWith('qoder-account-') ? this.ctx.get('dshQoderAccountUsage')
      : undefined;
    if (!source) return null;
    try {
      const value = await source.read(provider, signal);
      signal.throwIfAborted();
      const projected = usage.nullable().safeParse(value);
      return projected.success ? projected.data : null;
    } catch {
      signal.throwIfAborted();
      return null;
    }
  }
}

export function apply(ctx: Context): void {
  const usageService = new Usage(ctx);
  ctx.inject(['llm', 'credentials'], child => {
    const deepSeek = createDeepSeekApi(child);
    usageService.deepSeek = deepSeek;
    child.effect(() => () => {
      if (usageService.deepSeek === deepSeek) usageService.deepSeek = undefined;
    });
  });
}
