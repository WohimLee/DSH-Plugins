import { query, qodercliAuth, startDaemon } from '@qoder-ai/qoder-agent-sdk';
import type { AccountInfo, AuthOptions, Daemon, Options, SDKMessage, SDKUserMessage } from '@qoder-ai/qoder-agent-sdk';
import { createHash } from 'node:crypto';
import { addAbortListener } from 'node:events';
import { LlmError } from '@deepseek-ai/dsh-llm';
import { withDaemonStdinGuard } from './daemon-stdin.js';
import { authError, retryableRequestCodes, sdkRequestError, sessionCleanupError } from './failure.js';

export interface QoderSession {
  events: AsyncIterable<SDKMessage>;
  close(): Promise<void>;
}

export type AccountAuth = AuthOptions & { profile?: { configDir: string; identity?: string } };

function accountOptions({ profile, ...auth }: AccountAuth) {
  if (!profile) return { auth };
  const env = { ...process.env, QODER_CONFIG_DIR: profile.configDir,
    QODER_PERSONAL_ACCESS_TOKEN: undefined, QODER_SERVICE_ACCOUNT_KEY: undefined };
  return { auth, env };
}

async function accountIdentity(daemon: Daemon): Promise<string> {
  const id = (await daemon.accountInfo()).userId?.trim();
  if (!id || id.length > 1024) throw new LlmError('Qoder CLI 没有返回账号标识。请重新登录。', 'AUTH');
  return createHash('sha256').update(id).digest('hex');
}

async function verifyAccount(daemon: Daemon, auth: AccountAuth) {
  if (auth.profile?.identity && await accountIdentity(daemon) !== auth.profile.identity) {
    throw new LlmError('Qoder 配置目录的登录账号已变更，请重新绑定。', 'AUTH');
  }
}

type WaitForResponse = <T>(operation: Promise<T>) => Promise<T>;

async function withAccountRequest<T>(signal: AbortSignal, request: (wait: WaitForResponse) => Promise<T>): Promise<T> {
  signal.throwIfAborted();
  let listener: ReturnType<typeof addAbortListener> | undefined;
  const cancelled = new Promise<never>((_, reject) => {
    listener = addAbortListener(signal, () => reject(signal.reason));
  });
  try {
    return await request(operation => Promise.race([operation, cancelled]));
  } finally {
    listener?.[Symbol.dispose]();
  }
}

export async function openQoderSession(
  cliPath: string,
  input: AsyncIterable<SDKUserMessage>,
  options: Options,
  auth: AccountAuth,
): Promise<QoderSession> {
  const daemon = await withDaemonStdinGuard(cliPath, () => startDaemon({
    ...accountOptions(auth),
    pathToQoderCLIExecutable: cliPath,
    launchMode: 'process',
  }));
  try {
    options.abortController?.signal.throwIfAborted();
    if (auth.profile?.identity) {
      const timeout = AbortSignal.timeout(10_000);
      const request = options.abortController ? AbortSignal.any([timeout, options.abortController.signal]) : timeout;
      await withAccountRequest(request, wait => wait(verifyAccount(daemon, auth))).catch(error => { throw accountReadError(error); });
    }
    options.abortController?.signal.throwIfAborted();
    const events = query({ prompt: input, options: { ...options, daemon } });
    return {
      events,
      async close() {
        // The daemon is private to this attempt. Its confirmed shutdown is
        // sufficient even if a dead transport could not acknowledge close.
        try {
          await events.close();
        } catch {
          // Still stop the daemon rather than treating the close RPC as proof.
        }
        await daemon.stop();
      },
    };
  } catch (error) {
    try {
      await daemon.stop();
    } catch {
      // Preserve a permanent startup error, but never retry with uncertain teardown.
      if (retryableRequestCodes.includes(sdkRequestError(error).code)) throw sessionCleanupError();
    }
    throw error;
  }
}

function accountReadError(error: unknown): LlmError {
  const code = error instanceof Error && 'code' in error ? error.code : undefined;
  if ((typeof code === 'string' && /^(?:AUTH(?:_|$)|INVALID_(?:TOKEN|CREDENTIAL))/.test(code))
    || (error instanceof Error && (error.message.startsWith('Authentication required.')
      || error.message.startsWith('daemon auth is not initialized;')))) {
    return authError();
  }
  return sdkRequestError(error);
}

async function readAccount<T>(
  cliPath: string, auth: AccountAuth, signal: AbortSignal, timeoutMs: number,
  read: (daemon: Daemon, wait: WaitForResponse) => Promise<T>,
): Promise<T> {
  const timeout = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
  timeout.throwIfAborted();
  const daemon = await withDaemonStdinGuard(cliPath, () => startDaemon({
    pathToQoderCLIExecutable: cliPath, ...accountOptions(auth), launchMode: 'process', initializeTimeoutMs: Math.min(10_000, timeoutMs),
  }));
  try {
    // Each read owns its cleanup. Race only the RPCs against cancellation so
    // a catalog query can finish closing its session before the daemon stops.
    return await withAccountRequest(timeout, async wait => {
      await wait(verifyAccount(daemon, auth));
      return await read(daemon, wait);
    });
  } catch (error) {
    throw accountReadError(error);
  } finally {
    await daemon.stop();
  }
}

export function readQoderDesktopIdentity(cliPath: string, configDir: string | undefined, signal: AbortSignal) {
  const auth = { ...qodercliAuth(), ...(configDir && { profile: { configDir } }) };
  return readAccount(cliPath, auth, signal, 10_000, (daemon, wait) => wait(accountIdentity(daemon)));
}

export function readQoderModels(cliPath: string, auth: AccountAuth, signal: AbortSignal) {
  // CLI login opens an authenticated session before it can query the catalog.
  return readAccount(cliPath, auth, signal, 30_000, async (daemon, wait) => {
    if (auth.type !== 'qodercli') return wait(daemon.getModels({ fetchStrategy: 'live' }));
    // The daemon account plane requires a supplied credential on Qoder CLI 1.1.83.
    // A session can reuse CLI login and query the authenticated catalog without inference.
    let endInput!: () => void;
    const inputEnded = new Promise<void>(resolve => { endInput = resolve; });
    const session = query({
      prompt: (async function* () { await inputEnded; })(),
      options: { daemon, persistSession: false, settingSources: [], skills: [], tools: [], strictMcpConfig: true },
    });
    try {
      await wait(session.initializationResult());
      return await wait(session.getAvailableModels({ fetchStrategy: 'live' }));
    } finally {
      try {
        await session.close();
      } finally {
        endInput();
      }
    }
  });
}

function accountDisplay(info: AccountInfo, auth: AccountAuth): string | undefined {
  for (const value of [info.email, info.name, info.organizationName]) {
    if (typeof value !== 'string') continue;
    const label = value.trim();
    if (!label || label.length > 254 || /[\p{Cc}\p{Cf}]/u.test(label)) continue;
    if (auth.type === 'accessToken' && typeof auth.accessToken === 'string' && auth.accessToken && label.includes(auth.accessToken)) continue;
    return label;
  }
}

export function readQoderAccountDisplay(cliPath: string, auth: AccountAuth, signal: AbortSignal) {
  return readAccount(cliPath, auth, signal, 10_000, async (daemon, wait) =>
    accountDisplay(await wait(daemon.accountInfo()), auth));
}

export async function readQoderUsage(cliPath: string, auth: AccountAuth, signal: AbortSignal) {
  const result = await readAccount(cliPath, auth, signal, 8_000, (daemon, wait) => wait(daemon.getUsageInfo()));
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
