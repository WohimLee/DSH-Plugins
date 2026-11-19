import { spawn } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';
import { z } from 'zod';
import { threadId } from './remote.js';
import type { Config, Project, Session } from './remote.js';

const app = 'Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex';
const pageSize = 100;
const maxPages = 100;
const maxLineBytes = 8 * 1024 * 1024;
const thread = z.object({ id: threadId, name: z.string().nullish(), preview: z.string().optional(),
  cwd: z.string(), projectId: z.string().nullish(), updatedAt: z.number(), ephemeral: z.boolean().optional() });
const project = z.object({ id: z.string(), name: z.string(), roots: z.array(z.object({ path: z.string() })) });
const page = <T>(item: z.ZodType<T>) => z.object({ data: z.array(item).max(pageSize), nextCursor: z.string().nullable() });
const envelope = z.object({ id: z.number(), result: z.unknown().optional(), error: z.object({ code: z.number() }).optional() });

export type SyncErrorCode = 'missingCodex' | 'codexFailed' | 'syncTimeout' | 'invalidDirectory' | 'tooManyRecords';
export class SyncError extends Error {
  constructor(readonly code: SyncErrorCode) { super(code); }
}
class RpcError extends Error {
  constructor(readonly code: number) { super('Codex App Server rejected the request'); }
}

async function executable(): Promise<string> {
  const path = process.env.PATH?.split(delimiter).filter(isAbsolute) ?? [];
  const command = process.platform === 'win32' ? 'codex.exe' : 'codex';
  const candidates = [...path.map(directory => join(directory, command))];
  if (process.platform === 'darwin') candidates.push('/' + app, join(homedir(), app));
  for (const file of candidates) {
    try { await access(file, constants.X_OK); return file; } catch { /* Try the next installation. */ }
  }
  throw new SyncError('missingCodex');
}

async function pages<T>(call: (method: string, params: object) => Promise<unknown>, method: string,
  params: object, schema: z.ZodType<{ data: T[]; nextCursor: string | null }>): Promise<T[]> {
  let cursor: string | null = null;
  const seen = new Set<string>();
  const data: T[] = [];
  for (let index = 0; index < maxPages; index++) {
    const next = schema.parse(await call(method, { ...params, cursor, limit: pageSize }));
    data.push(...next.data);
    cursor = next.nextCursor;
    if (cursor === null) return data;
    if (seen.has(cursor)) throw new SyncError('codexFailed');
    seen.add(cursor);
  }
  throw new SyncError('tooManyRecords');
}

export async function readCodex(config: Config, signal: AbortSignal): Promise<{
  projects: Project[]; sessions: Session[]; projectsAvailable: boolean;
}> {
  if (config.cwd && (!isAbsolute(config.cwd) || config.cwd.includes('\0'))) throw new SyncError('invalidDirectory');
  const file = await executable();
  signal.throwIfAborted();
  const deadline = AbortSignal.timeout(20000);
  const lifetime = AbortSignal.any([signal, deadline]);
  const child = spawn(file, ['app-server', '--stdio'], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
  let id = 0;
  let pending: { id: number; resolve: (value: unknown) => void; reject: (reason: unknown) => void } | undefined;
  let ended = false;
  const fail = (reason: unknown) => { ended = true; pending?.reject(reason); pending = undefined; };
  const stop = () => { fail(lifetime.reason); child.kill('SIGKILL'); };
  const closed = new Promise<void>(resolve => child.once('close', () => { fail(new SyncError('codexFailed')); resolve(); }));
  child.on('error', () => fail(new SyncError('codexFailed')));
  child.stdin.on('error', () => fail(new SyncError('codexFailed')));
  lifetime.addEventListener('abort', stop, { once: true });
  let line = Buffer.alloc(0);
  child.stdout.on('data', (chunk: Buffer) => {
    let offset = 0;
    while (offset < chunk.length && !ended) {
      const newline = chunk.indexOf(10, offset);
      const part = chunk.subarray(offset, newline === -1 ? chunk.length : newline);
      if (line.length + part.length > maxLineBytes) { fail(new SyncError('codexFailed')); break; }
      line = Buffer.concat([line, part]);
      if (newline === -1) break;
      const body = line.toString('utf8');
      line = Buffer.alloc(0);
      offset = newline + 1;
      if (!body.trim()) continue;
      try {
        const response = envelope.safeParse(JSON.parse(body));
        if (!response.success || !pending || response.data.id !== pending.id) continue;
        const { result, error } = response.data;
        const request = pending;
        pending = undefined;
        if (error) request.reject(new RpcError(error.code));
        else request.resolve(result);
      } catch { fail(new SyncError('codexFailed')); }
    }
  });
  const send = (message: object) => child.stdin.write(JSON.stringify(message) + '\n');
  const call = (method: string, params: object) => new Promise<unknown>((resolve, reject) => {
    if (ended || lifetime.aborted) { reject(lifetime.reason ?? new SyncError('codexFailed')); return; }
    pending = { id: ++id, resolve, reject };
    send({ id, method, params });
  });
  try {
    await call('initialize', { clientInfo: { name: 'dsh_agent_sync', version: '0.1.0' }, capabilities: { experimentalApi: true } });
    send({ method: 'initialized' });
    let projectsAvailable = true;
    let projects: Project[] = [];
    try {
      projects = (await pages(call, 'project/list', {}, page(project))).map(value => ({
        id: value.id, name: value.name, roots: value.roots.map(root => root.path),
      }));
    } catch (error) {
      if (!(error instanceof RpcError) || error.code !== -32601) throw error;
      projectsAvailable = false;
    }
    const sessions = new Map<string, Session>();
    for (const archived of config.archived ? [false, true] : [false]) {
      const threads = await pages(call, 'thread/list', { archived, ...(config.cwd && { cwd: config.cwd }),
        currentAccountOnly: true, useStateDbOnly: true, modelProviders: [], sortKey: 'updated_at',
        sourceKinds: ['cli', 'vscode', 'appServer'],
      }, page(thread));
      for (const item of threads) {
        if (item.ephemeral || sessions.has(item.id)) continue;
        const title = (item.name?.trim() || item.preview?.trim() || 'Untitled').slice(0, 240);
        sessions.set(item.id, { id: item.id, title, cwd: item.cwd, projectId: item.projectId ?? null,
          updatedAt: item.updatedAt, archived });
      }
    }
    if (config.cwd) {
      const matched = new Set([...sessions.values()].map(item => item.projectId));
      projects = projects.filter(item => matched.has(item.id) || item.roots.includes(config.cwd));
    }
    return { projects, sessions: [...sessions.values()], projectsAvailable };
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    if (deadline.aborted) throw new SyncError('syncTimeout');
    throw error instanceof SyncError ? error : new SyncError('codexFailed');
  } finally {
    lifetime.removeEventListener('abort', stop);
    child.kill('SIGKILL');
    await closed;
  }
}
