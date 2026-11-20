import type { RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol';
import { z } from 'zod';

export const accountService = 'dshQoderAccounts';
const loginAction = z.enum(['start', 'status', 'cancel']);
const loginView = z.object({
  state: z.enum(['idle', 'preparing', 'waiting', 'authorized', 'failed', 'expired']),
  url: z.string().optional(),
});
export type LoginAction = z.infer<typeof loginAction>;
export type LoginView = z.infer<typeof loginView>;

const accountView = z.object({
  provider: z.string(),
  name: z.string(),
  remark: z.string().optional(),
  state: z.enum(['connected', 'unbound', 'cliMissing', 'authFailed', 'noModels', 'unavailable']),
  browserLogin: z.boolean().optional(),
  modelCount: z.number().int().nonnegative(),
});

const provider = z.string().regex(/^qoder-account-[a-z0-9][a-z0-9-]{0,31}$/);
const remark = z.string().trim().max(80);
const token = z.string().trim().min(1).max(8192);
const accountChange = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('add'), remark, token }),
  z.strictObject({ kind: z.literal('remark'), provider, remark }),
  z.strictObject({ kind: z.literal('replace'), provider, token }),
  z.strictObject({ kind: z.literal('unbind'), provider }),
]);

export type AccountChange = z.infer<typeof accountChange>;
export const parseAccountChange = (value: unknown) => accountChange.parse(value);

export type AccountView = z.infer<typeof accountView>;

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespaceMap {
    dshQoderAccounts: {
      login(action: LoginAction): Promise<RemoteResult<LoginView>>;
      list(refresh: boolean): Promise<RemoteResult<AccountView[]>>;
      change(change: AccountChange): Promise<RemoteResult<boolean>>;
    };
  }
}

export const contribution: TypertRemoteContribution = {
  package: 'dsh-qoder',
  descriptors: [{
    id: 'dsh-qoder#dshQoderAccounts/login', service: accountService, namespace: accountService, method: 'login',
    invocation: { kind: 'direct' },
    parameters: [{ name: 'action', wire: 'action', source: 'json',
      codec: { mode: 'strict', typeSymbol: 'LoginAction', create: () => loginAction } }],
    result: { mode: 'strict', typeSymbol: 'LoginView', create: () => loginView },
  }, {
    id: 'dsh-qoder#dshQoderAccounts/list', service: accountService, namespace: accountService, method: 'list',
    invocation: { kind: 'direct' },
    parameters: [{ name: 'refresh', wire: 'refresh', source: 'json',
      codec: { mode: 'strict', typeSymbol: 'boolean', create: () => z.boolean() } }],
    result: { mode: 'strict', typeSymbol: 'AccountView[]', create: () => z.array(accountView) },
  }, {
    id: 'dsh-qoder#dshQoderAccounts/change', service: accountService, namespace: accountService, method: 'change',
    invocation: { kind: 'direct' },
    parameters: [{ name: 'change', wire: 'change', source: 'json',
      codec: { mode: 'strict', typeSymbol: 'AccountChange', create: () => accountChange } }],
    result: { mode: 'strict', typeSymbol: 'boolean', create: () => z.boolean() },
  }],
};
