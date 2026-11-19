import { query, startDaemon } from '@qoder-ai/qoder-agent-sdk';
import type { AuthOptions, Daemon, Options, SDKMessage, SDKUserMessage } from '@qoder-ai/qoder-agent-sdk';
import { addAbortListener } from 'node:events';
import { LlmError } from '@deepseek-ai/dsh-llm';

export interface QoderSession {
  events: AsyncIterable<SDKMessage>;
  close(): Promise<void>;
}

export async function openQoderSession(
  cliPath: string,
  input: AsyncIterable<SDKUserMessage>,
  options: Options,
  auth: AuthOptions,
): Promise<QoderSession> {
  const daemon = await startDaemon({
    auth,
    pathToQoderCLIExecutable: cliPath,
    launchMode: 'process',
  });
  try {
    options.abortController?.signal.throwIfAborted();
    const events = query({ prompt: input, options: { ...options, daemon } });
    return {
      events,
      async close() {
        try {
          await events.close();
        } finally {
          await daemon.stop();
        }
      },
    };
  } catch (error) {
    await daemon.stop();
    throw error;
  }
}

async function readAccount<T>(cliPath: string, auth: AuthOptions, signal: AbortSignal, read: (daemon: Daemon) => Promise<T>): Promise<T> {
  const timeout = AbortSignal.any([signal, AbortSignal.timeout(8000)]);
  timeout.throwIfAborted();
  const daemon = await startDaemon({
    pathToQoderCLIExecutable: cliPath, auth, launchMode: 'process', initializeTimeoutMs: 5000,
  });
  try {
    timeout.throwIfAborted();
    let listener: ReturnType<typeof addAbortListener> | undefined;
    const cancelled = new Promise<never>((_, reject) => {
      listener = addAbortListener(timeout, () => reject(timeout.reason));
    });
    return await Promise.race([read(daemon), cancelled]).finally(() => listener?.[Symbol.dispose]());
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? error.code : undefined;
    if ((typeof code === 'string' && /^(?:AUTH(?:_|$)|INVALID_(?:TOKEN|CREDENTIAL))/.test(code))
      || (error instanceof Error && (error.message.startsWith('Authentication required.')
        || error.message.startsWith('daemon auth is not initialized;')))) {
      throw new LlmError('Qoder 认证失败，请检查绑定的 PAT 或 Qoder CLI 登录。', 'AUTH');
    }
    throw new LlmError('无法读取 Qoder 账号信息，请检查连接后重试。', 'TRANSPORT');
  } finally {
    await daemon.stop();
  }
}

export function readQoderModels(cliPath: string, auth: AuthOptions, signal: AbortSignal) {
  return readAccount(cliPath, auth, signal, async daemon => {
    if (auth.type !== 'qodercli') return daemon.getModels({ fetchStrategy: 'live' });
    // The daemon account plane requires a supplied credential on Qoder CLI 1.1.83.
    // A session can reuse CLI login and query the authenticated catalog without inference.
    let endInput!: () => void;
    const inputEnded = new Promise<void>(resolve => { endInput = resolve; });
    const session = query({
      prompt: (async function* () { await inputEnded; })(),
      options: { daemon, persistSession: false, settingSources: [], skills: [], tools: [], strictMcpConfig: true },
    });
    try {
      await session.initializationResult();
      return await session.getAvailableModels();
    } finally {
      endInput();
      await session.close();
    }
  });
}

export async function readQoderUsage(cliPath: string, auth: AuthOptions, signal: AbortSignal) {
  const result = await readAccount(cliPath, auth, signal, daemon => daemon.getUsageInfo());
  if (!result) return null;
  const plan = quota(result.userQuota?.remaining, result.userQuota?.total);
  const addOn = quota(result.addOnQuota?.remaining, result.addOnQuota?.total);
  const organization = quota(result.orgResourcePackage?.remaining, result.orgResourcePackage?.cap);
  if (!plan && !addOn && !organization) return null;
  return { credits: { plan, addOn, organization } };
}

function quota(remaining?: number, total?: number) {
  if (remaining === undefined || !Number.isFinite(remaining) || remaining < 0) return undefined;
  return { remaining, ...(total !== undefined && Number.isFinite(total) && total >= 0 ? { total } : {}) };
}
