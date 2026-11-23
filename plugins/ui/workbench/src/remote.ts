import type { InvocationDescriptor, RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol';
import { z } from 'zod';

export const service = 'workbenchSessions';
export interface WorkbenchSessionsRemote {
  createStandalone(signal?: AbortSignal): Promise<RemoteResult<string>>;
  prepareUngroupedDirectory(signal?: AbortSignal): Promise<RemoteResult<string>>;
  directory(sessionId: string, signal?: AbortSignal): Promise<RemoteResult<string>>;
  setDirectory(sessionId: string, path: string, signal?: AbortSignal): Promise<RemoteResult<string>>;
  deleteSession(sessionId: string, signal?: AbortSignal): Promise<RemoteResult<'deleted' | 'restart-required'>>;
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespaceMap { workbenchSessions: WorkbenchSessionsRemote }
  interface TypertRemoteMap {
    'workbenchSessions/deleteSession': WorkbenchSessionsRemote['deleteSession'];
    'workbenchSessions/prepareUngroupedDirectory': WorkbenchSessionsRemote['prepareUngroupedDirectory'];
  }
  interface RemoteErrorDetailsMap {
    'workbench/denied': undefined;
    'workbench/session-unavailable': undefined;
    'workbench/invalid-directory': undefined;
    'workbench/session-busy': undefined;
    'workbench/delete-unavailable': undefined;
    'workbench/delete-failed': undefined;
  }
}

const parameter = (name: string, max: number): InvocationDescriptor['parameters'][number] => ({
  name, wire: name, source: 'json', codec: { mode: 'strict', typeSymbol: 'string', create: () => z.string().min(1).max(max) },
});
const method = (name: string, parameters: InvocationDescriptor['parameters']): InvocationDescriptor => ({
  id: `dsh-workbench#${service}/${name}`, service, namespace: service, method: name, invocation: { kind: 'direct' }, parameters,
  result: { mode: 'strict', typeSymbol: 'string', create: () => z.string() },
  cancellation: { parameter: 'signal' },
});
const session = parameter('sessionId', 256);
export const contribution: TypertRemoteContribution = {
  package: 'dsh-workbench',
  descriptors: [method('createStandalone', []), method('prepareUngroupedDirectory', []), method('directory', [session]), method('setDirectory', [session, parameter('path', 4096)]),
    method('deleteSession', [session])],
};
