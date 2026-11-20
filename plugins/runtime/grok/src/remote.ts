import type { RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol';
import { z } from 'zod';

export const service = 'dshGrokConnection';
export const change = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('connect'), key: z.string().trim().min(1).max(4096) }),
  z.strictObject({ kind: z.literal('disconnect') }),
]);
const view = z.object({
  state: z.enum(['unbound', 'connected', 'unauthorized', 'unavailable', 'empty']),
  modelCount: z.number().int().nonnegative(),
  error: z.enum(['unauthorized', 'unavailable', 'empty', 'storage']).optional(),
});
export type Change = z.infer<typeof change>;
export type ConnectionView = z.infer<typeof view>;

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespaceMap {
    dshGrokConnection: {
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
    id: 'dsh-grok#dshGrokConnection/update', service, namespace: service, method: 'update',
    invocation: { kind: 'direct' },
    parameters: [{ name: 'input', wire: 'input', source: 'json',
      codec: { mode: 'strict', typeSymbol: 'Change', create: () => change } }],
    result,
  }],
};
