import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-typert-registry';
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { contribution, service, usage } from './remote.js';
import type { ProviderUsage, UsageProvider } from './remote.js';

export const name = 'dsh-model-picker';
export const inject = ['typert'];

declare module '@deepseek-ai/cordis' {
  interface Context {
    dshCodexAccountUsage: UsageProvider & { connected?: () => Promise<boolean> };
    dshQoderAccountUsage: UsageProvider;
  }
}

class Usage extends TypertRemoteService {
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
  async read(provider: string, signal: AbortSignal): Promise<ProviderUsage | null> {
    if (this.ctx.invocation?.peer.principal.kind !== 'owner') return null;
    signal.throwIfAborted();
    const source = provider === 'codex' ? this.ctx.get('dshCodexAccountUsage')
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
  new Usage(ctx);
}
