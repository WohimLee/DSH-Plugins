import type { InvocationDescriptor, RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol';
import { z } from 'zod';

export const service = 'agentSync';
export const threadId = z.string().regex(/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i);
const config = z.strictObject({ cwd: z.string().max(4096), archived: z.boolean() });
const project = z.object({ id: z.string(), name: z.string(), roots: z.array(z.string()) });
const session = z.object({ id: threadId, title: z.string(), cwd: z.string(), projectId: z.string().nullable(),
  updatedAt: z.number(), archived: z.boolean() });
const snapshot = z.object({ config, syncedAt: z.number().nullable(), projectsAvailable: z.boolean(),
  projects: z.array(project), sessions: z.array(session) });
export type Config = z.infer<typeof config>;
export type Project = z.infer<typeof project>;
export type Session = z.infer<typeof session>;
export type Snapshot = z.infer<typeof snapshot>;
export const emptySnapshot: Snapshot = {
  config: { cwd: '', archived: false }, syncedAt: null, projectsAvailable: true, projects: [], sessions: [],
};

export interface AgentSyncRemote {
  status(): Promise<RemoteResult<Snapshot>>;
  sync(options: Config, signal?: AbortSignal): Promise<RemoteResult<Snapshot>>;
  disconnect(): Promise<RemoteResult<Snapshot>>;
  open(id: string, signal?: AbortSignal): Promise<RemoteResult<boolean>>;
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    'agent-sync/denied': undefined;
    'agent-sync/busy': undefined;
    'agent-sync/cancelled': undefined;
    'agent-sync/codexFailed': undefined;
    'agent-sync/missingCodex': undefined;
    'agent-sync/syncTimeout': undefined;
    'agent-sync/invalidDirectory': undefined;
    'agent-sync/tooManyRecords': undefined;
    'agent-sync/unknownThread': undefined;
    'agent-sync/openUnavailable': undefined;
    'agent-sync/openFailed': undefined;
  }
  interface TypertRemoteNamespaceMap { agentSync: AgentSyncRemote }
}

const codec = (typeSymbol: string, schema: z.ZodType) => ({ mode: 'strict' as const, typeSymbol, create: () => schema });
const descriptor = (method: string, result: InvocationDescriptor['result'],
  parameters: InvocationDescriptor['parameters'] = [], cancellable = false): InvocationDescriptor => ({
  id: `dsh-agent-sync#agentSync/${method}`, service, namespace: service, method,
  invocation: { kind: 'direct' }, parameters, result,
  cancellation: cancellable ? { parameter: 'signal' } : undefined,
});
const snapshotCodec = codec('AgentSyncSnapshot', snapshot);
export const contribution: TypertRemoteContribution = {
  package: 'dsh-agent-sync',
  descriptors: [
    descriptor('status', snapshotCodec),
    descriptor('sync', snapshotCodec, [{ name: 'options', wire: 'options', source: 'json', codec: codec('AgentSyncConfig', config) }], true),
    descriptor('disconnect', snapshotCodec),
    descriptor('open', codec('boolean', z.boolean()), [{ name: 'id', wire: 'id', source: 'json', codec: codec('CodexThreadId', threadId) }], true),
  ],
};
