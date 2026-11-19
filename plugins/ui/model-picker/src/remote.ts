import type { RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol';
import { z } from 'zod';

export const service = 'dshModelPickerUsage';
const number = z.number().nonnegative();
const percent = number.max(100);
const quota = z.object({
  remaining: number,
  total: number.optional(),
});

export const usage = z.object({
  windows: z.array(z.object({
    remainingPercent: percent,
    minutes: number,
    resetsAt: number.optional(),
  })).optional(),
  credits: z.object({
    plan: quota.optional(),
    addOn: quota.optional(),
    organization: quota.optional(),
  }).optional(),
});
export type ProviderUsage = z.infer<typeof usage>;
export type UsageProvider = { read(provider: string, signal: AbortSignal): Promise<ProviderUsage | null> };

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespaceMap {
    dshModelPickerUsage: {
      read(provider: string, signal?: AbortSignal): Promise<RemoteResult<ProviderUsage | null>>;
      codexConnection(): Promise<RemoteResult<boolean | null>>;
    };
  }
}

export const contribution: TypertRemoteContribution = {
  package: 'dsh-model-picker',
  descriptors: [{
    id: 'dsh-model-picker#dshModelPickerUsage/read', service, namespace: service, method: 'read',
    invocation: { kind: 'direct' },
    parameters: [{ name: 'provider', wire: 'provider', source: 'json',
      codec: { mode: 'strict', typeSymbol: 'string', create: () => z.string().min(1).max(100) } }],
    result: { mode: 'strict', typeSymbol: 'ProviderUsage', create: () => usage.nullable() },
    cancellation: { parameter: 'signal' },
  }, {
    id: 'dsh-model-picker#dshModelPickerUsage/codexConnection', service, namespace: service, method: 'codexConnection',
    invocation: { kind: 'direct' }, parameters: [],
    result: { mode: 'strict', typeSymbol: 'CodexConnection', create: () => z.boolean().nullable() },
  }],
};
