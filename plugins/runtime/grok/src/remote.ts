import type { RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol';
import { z } from 'zod';

export const service = 'dshGrokConnection';
export const defaultAccountId = 'default';
const accountId = z.union([z.literal(defaultAccountId), z.uuid()]);
const apiKey = z.string().trim().min(1).max(4096);
export const change = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('connect'), key: apiKey }),
  z.strictObject({ kind: z.literal('add'), key: apiKey, label: z.string().trim().min(1).max(80) }),
  z.strictObject({ kind: z.literal('replace'), key: apiKey, id: accountId }),
  z.strictObject({ kind: z.literal('disconnect'), id: accountId.optional() }),
]);
const state = z.enum(['unbound', 'connected', 'unauthorized', 'unavailable', 'empty']);
const count = z.number().int().nonnegative();
const account = z.object({
  id: accountId,
  label: z.string().optional(),
  state: state.exclude(['unbound']),
  modelCount: count,
});
const view = z.object({
  state,
  modelCount: count,
  error: z.enum(['unauthorized', 'unavailable', 'empty', 'storage']).optional(),
  accounts: z.array(account),
});
export type Change = z.infer<typeof change>;
export type AccountView = z.infer<typeof account>;
export type ConnectionView = z.infer<typeof view>;

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespaceMap {
    dshGrokConnection: {
      desktopInstalled(signal?: AbortSignal): Promise<RemoteResult<boolean | null>>;
      read(refresh: boolean): Promise<RemoteResult<ConnectionView | null>>;
      update(input: Change): Promise<RemoteResult<ConnectionView | null>>;
    };
  }
}

const result = { mode: 'strict' as const, typeSymbol: 'ConnectionView', create: () => view.nullable() };
export const contribution: TypertRemoteContribution = {
  package: 'dsh-grok',
  descriptors: [{
    id: 'dsh-grok#dshGrokConnection/read', service, namespace: service, method: 'read',
    invocation: { kind: 'direct' },
    parameters: [{ name: 'refresh', wire: 'refresh', source: 'json',
      codec: { mode: 'strict', typeSymbol: 'boolean', create: () => z.boolean() } }],
    result,
  }, {
    id: 'dsh-grok#dshGrokConnection/desktopInstalled', service, namespace: service, method: 'desktopInstalled',
    invocation: { kind: 'direct' }, parameters: [],
    result: { mode: 'strict', typeSymbol: 'GrokDesktopInstalled', create: () => z.boolean().nullable() },
    cancellation: { parameter: 'signal' },
  }, {
    id: 'dsh-grok#dshGrokConnection/update', service, namespace: service, method: 'update',
    invocation: { kind: 'direct' },
    parameters: [{ name: 'input', wire: 'input', source: 'json',
      codec: { mode: 'strict', typeSymbol: 'Change', create: () => change } }],
    result,
  }],
};
