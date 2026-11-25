import type { RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol';
import { z } from 'zod';

export const service = 'dshModelPickerUsage';
const number = z.number().nonnegative();
const percent = number.max(100);
const quota = z.object({
  remaining: number,
  total: number.optional(),
});

const wallet = z.object({ currency: z.string(), balance: z.string() });
export const usage = z.object({
  wallets: z.array(wallet).optional(),
  bonus: z.array(wallet).optional(),
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
export const codexDesktop = z.object({
  installed: z.boolean(), canManage: z.boolean(),
  accounts: z.array(z.object({
    provider: z.string(), label: z.string().nullable(), signedIn: z.boolean(),
    modelCount: z.number().int().nonnegative(), removable: z.boolean(),
  })),
});
export const codexAccountChange = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('add'), home: z.string().trim().min(1).max(4096), label: z.string().trim().max(80) }),
  z.strictObject({ kind: z.literal('remove'), provider: z.string().regex(/^codex-account-[a-z0-9-]+$/).max(100) }),
]);
export const codexAccountResult = z.enum(['ok', 'unavailable', 'invalidHome', 'signedOut', 'duplicate', 'notFound', 'storage']);
export type CodexDesktop = z.infer<typeof codexDesktop>;
export type CodexAccountChange = z.infer<typeof codexAccountChange>;
export type CodexAccountResult = z.infer<typeof codexAccountResult>;
export const codexApi = z.object({
  canManage: z.boolean(),
  accounts: z.array(z.object({
    provider: z.string(), label: z.string(), connected: z.boolean(), modelCount: z.number().int().nonnegative(),
  })),
});
const apiAccountChange = (provider: RegExp) => z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('add'), label: z.string().trim().min(1).max(80), key: z.string().trim().min(1).max(8192) }),
  z.strictObject({ kind: z.enum(['remove', 'refresh']), provider: z.string().regex(provider).max(100) }),
]);
export const codexApiChange = apiAccountChange(/^codex-api-account-[a-z0-9-]+$/);
export const deepSeekApiChange = apiAccountChange(/^deepseek-api-account-[a-z0-9-]+$/);
export const codexApiResult = z.enum(['ok', 'unavailable', 'invalidKey', 'invalidLabel', 'duplicate', 'notFound', 'noModels', 'network', 'storage']);
export type CodexApi = z.infer<typeof codexApi>;
export type CodexApiChange = z.infer<typeof codexApiChange>;
export type CodexApiResult = z.infer<typeof codexApiResult>;

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespaceMap {
    dshModelPickerUsage: {
      read(provider: string, signal?: AbortSignal): Promise<RemoteResult<ProviderUsage | null>>;
      codexConnection(): Promise<RemoteResult<boolean | null>>;
      codexDesktop(signal?: AbortSignal): Promise<RemoteResult<CodexDesktop | null>>;
      changeCodexDesktop(change: CodexAccountChange, signal?: AbortSignal): Promise<RemoteResult<CodexAccountResult>>;
      codexApi(signal?: AbortSignal): Promise<RemoteResult<CodexApi | null>>;
      changeCodexApi(change: CodexApiChange, signal?: AbortSignal): Promise<RemoteResult<CodexApiResult>>;
      deepSeekApi(signal?: AbortSignal): Promise<RemoteResult<CodexApi | null>>;
      changeDeepSeekApi(change: CodexApiChange, signal?: AbortSignal): Promise<RemoteResult<CodexApiResult>>;
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
  }, {
    id: 'dsh-model-picker#dshModelPickerUsage/codexDesktop', service, namespace: service, method: 'codexDesktop',
    invocation: { kind: 'direct' }, parameters: [],
    result: { mode: 'strict', typeSymbol: 'CodexDesktop', create: () => codexDesktop.nullable() },
    cancellation: { parameter: 'signal' },
  }, {
    id: 'dsh-model-picker#dshModelPickerUsage/changeCodexDesktop', service, namespace: service, method: 'changeCodexDesktop',
    invocation: { kind: 'direct' },
    parameters: [{ name: 'change', wire: 'change', source: 'json',
      codec: { mode: 'strict', typeSymbol: 'CodexAccountChange', create: () => codexAccountChange } }],
    result: { mode: 'strict', typeSymbol: 'CodexAccountResult', create: () => codexAccountResult },
    cancellation: { parameter: 'signal' },
  }, {
    id: 'dsh-model-picker#dshModelPickerUsage/codexApi', service, namespace: service, method: 'codexApi',
    invocation: { kind: 'direct' }, parameters: [],
    result: { mode: 'strict', typeSymbol: 'CodexApi', create: () => codexApi.nullable() },
    cancellation: { parameter: 'signal' },
  }, {
    id: 'dsh-model-picker#dshModelPickerUsage/changeCodexApi', service, namespace: service, method: 'changeCodexApi',
    invocation: { kind: 'direct' },
    parameters: [{ name: 'change', wire: 'change', source: 'json',
      codec: { mode: 'strict', typeSymbol: 'CodexApiChange', create: () => codexApiChange } }],
    result: { mode: 'strict', typeSymbol: 'CodexApiResult', create: () => codexApiResult },
    cancellation: { parameter: 'signal' },
  }, {
    id: 'dsh-model-picker#dshModelPickerUsage/deepSeekApi', service, namespace: service, method: 'deepSeekApi',
    invocation: { kind: 'direct' }, parameters: [],
    result: { mode: 'strict', typeSymbol: 'ApiAccounts', create: () => codexApi.nullable() },
    cancellation: { parameter: 'signal' },
  }, {
    id: 'dsh-model-picker#dshModelPickerUsage/changeDeepSeekApi', service, namespace: service, method: 'changeDeepSeekApi',
    invocation: { kind: 'direct' },
    parameters: [{ name: 'change', wire: 'change', source: 'json',
      codec: { mode: 'strict', typeSymbol: 'ApiAccountChange', create: () => deepSeekApiChange } }],
    result: { mode: 'strict', typeSymbol: 'ApiAccountResult', create: () => codexApiResult },
    cancellation: { parameter: 'signal' },
  }],
};
