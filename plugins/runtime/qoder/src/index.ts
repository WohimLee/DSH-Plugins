import { constants } from 'node:fs';
import { access, mkdtemp, rm, stat } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';
import type { Context } from '@deepseek-ai/cordis';
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials';
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import type {} from '@deepseek-ai/dsh-typert-registry';
import Schema from '@deepseek-ai/schemastery';
import { LlmAdapter, LlmError } from '@deepseek-ai/dsh-llm';
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm';
import { ControlRequestError } from '@qoder-ai/qoder-agent-sdk';
import type { SDKUserMessage } from '@qoder-ai/qoder-agent-sdk';
import { advertiseTools, buildPrompt } from './request.js';
import { openQoderSession, readQoderModels, readQoderUsage } from './runtime.js';
import { BrowserLogin } from './login.js';
import type { LoginAction, LoginView } from './remote.js';
import { QoderAccounts } from './accounts.js';
import { isQoderAccountRecord } from './account-store.js';
import type { AccountConfig } from './account-store.js';
import { accountService, contribution, parseAccountChange } from './remote.js';
import type { AccountChange, AccountView } from './remote.js';
import type { QoderSession } from './runtime.js';
import { authError, readResponse } from './stream.js';

export const name = 'dsh-qoder';
export const inject = ['llm'];

export interface PluginConfig {
  cliPath?: string;
  accounts?: AccountConfig[];
}

export const Config: Schema<PluginConfig> = Schema.object({
  cliPath: Schema.string().description('Qoder CLI 可执行文件的绝对路径。省略时自动查找。'),
  accounts: Schema.union([Schema.const(undefined), Schema.array(Schema.object({
    id: Schema.string().required(),
    name: Schema.string().required(),
    tokenEnv: Schema.string().required(),
    models: Schema.union([Schema.const(undefined), Schema.array(Schema.string())]),
  }))]).description('Qoder 账号列表。tokenEnv 只填写宿主环境变量名。'),
});

async function resolveCli(cliPath?: string): Promise<string> {
  if (cliPath && !isAbsolute(cliPath)) {
    throw new LlmError('Qoder 插件的 cliPath 必须为绝对路径。', 'INVALID_REQUEST');
  }
  const executable = process.platform === 'win32' ? 'qodercli.exe' : 'qodercli';
  const candidates = cliPath ? [cliPath] : [
    ...((process.env.PATH ?? '').split(delimiter)
      .filter(isAbsolute).map(directory => join(directory, executable))),
    join(homedir(), '.local', 'bin', executable),
    join(homedir(), '.qoder', 'bin', 'qodercli', executable),
  ];
  for (const candidate of candidates) {
    if (!(await stat(candidate, { throwIfNoEntry: false }).catch(() => undefined))?.isFile()) continue;
    const mode = process.platform === 'win32' ? constants.F_OK : constants.X_OK;
    if (await access(candidate, mode).then(() => true, () => false)) return candidate;
  }
  throw new LlmError('找不到 Qoder CLI。请安装 Qoder CLI 或在插件配置中填写 cliPath。', 'INVALID_CONFIG');
}

async function* userInput(input: SDKUserMessage): AsyncGenerator<SDKUserMessage> {
  yield input;
}

export class QoderAdapter extends LlmAdapter {
  private readonly lifetime = new AbortController();
  readonly accounts: QoderAccounts;

  constructor(
    private readonly config: PluginConfig = {},
    private readonly openSession = openQoderSession,
    private readonly readModels = readQoderModels,
    resolveSecret = async (ref: string) => process.env[ref],
    credentials: () => CredentialProvider | undefined = () => undefined,
    private readonly attachments: () => Pick<Context['attachments'], 'readImageRequest'> | undefined = () => undefined,
  ) {
    super();
    this.accounts = new QoderAccounts(config.accounts, resolveSecret, async auth => {
      const executable = await resolveCli(config.cliPath);
      return this.readModels(executable, auth, this.lifetime.signal);
    }, credentials, () => !!this.attachments());
  }

  get providers(): string[] {
    return this.accounts.providers;
  }

  async usage(provider: string, signal: AbortSignal) {
    if (!this.providers.includes(provider)) return null;
    const auth = await this.accounts.auth(provider);
    const executable = await resolveCli(this.config.cliPath);
    return readQoderUsage(executable, auth, AbortSignal.any([signal, this.lifetime.signal]));
  }

  dispose(): void {
    this.lifetime.abort();
  }

  override providerInfo(provider: string) {
    return { id: provider, name: this.accounts.providerName(provider) };
  }

  override async listModels(provider: string): Promise<LlmResolvedModelInfo[]> {
    try {
      return await this.accounts.listModels(provider, await this.accounts.auth(provider));
    } catch {
      return [];
    }
  }

  override async resolveModel(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo> {
    signal?.throwIfAborted();
    return this.resolveAccountModel(provider, model, await this.accounts.auth(provider), signal);
  }

  private async resolveAccountModel(provider: string, model: string, auth: Awaited<ReturnType<QoderAccounts['auth']>>, signal?: AbortSignal) {
    const resolved = (await this.accounts.listModels(provider, auth)).find(item => item.id === model);
    signal?.throwIfAborted();
    if (!resolved) throw new LlmError('此模型不在所选 Qoder 账号的可用目录中。', 'UNKNOWN_MODEL');
    return resolved;
  }

  override async *stream(options: GenerateOptions): AsyncGenerator<StreamChunk> {
    const signal = options.signal
      ? AbortSignal.any([this.lifetime.signal, options.signal])
      : this.lifetime.signal;
    const abortController = new AbortController();
    const abort = () => abortController.abort();
    let cwd: string | undefined;
    let session: QoderSession | undefined;
    let failedAuth = false;
    let finish: Extract<StreamChunk, { type: 'finish' }> | undefined;

    try {
      signal.throwIfAborted();
      signal.addEventListener('abort', abort, { once: true });
      const auth = await this.accounts.auth(options.provider);
      const model = await this.resolveAccountModel(options.provider, options.model, auth, signal);
      const { input, systemPrompt } = await buildPrompt({ ...options, signal }, model.inputModalities?.includes('image') ? this.attachments() : undefined);
      const effort = model.reasoning && options.reasoningEffort;
      if (effort && !model.reasoning?.efforts.some(level => level.id === effort)) {
        throw new LlmError('所选 Qoder 账号的模型不支持此推理强度。', 'UNSUPPORTED_REASONING_EFFORT');
      }
      const executable = await resolveCli(this.config.cliPath);
      cwd = await mkdtemp(join(tmpdir(), 'dsh-qoder-'));
      signal.throwIfAborted();
      const { toolNames, mcpServers } = advertiseTools(options.tools);
      const extraArgs: Record<string, string> = {};
      if (options.maxTokens !== undefined) {
        if (!Number.isSafeInteger(options.maxTokens) || options.maxTokens < 1) {
          throw new LlmError('maxTokens 必须为正整数。', 'INVALID_REQUEST');
        }
        if (model.maxOutputTokens !== undefined && options.maxTokens > model.maxOutputTokens) {
          throw new LlmError('所请求的 maxTokens 超过该账号模型目录声明的最大输出。', 'INVALID_REQUEST');
        }
        extraArgs['max-output-tokens'] = String(options.maxTokens);
      }
      session = await this.openSession(executable, userInput(input), {
        cwd,
        systemPrompt,
        model: options.model,
        ...(effort && { resolveModel: ({ purpose }) => purpose === 'main'
          ? { model: model.id, parameters: { reasoningEffort: effort } } : undefined }),
        abortController,
        maxTurns: 1,
        includePartialMessages: true,
        persistSession: false,
        settingSources: [],
        skills: [],
        tools: [],
        strictMcpConfig: true,
        mcpServers,
        permissionMode: 'default',
        canUseTool: async (_name, _input, { toolUseID }) => ({
          behavior: 'deny', toolUseID, message: 'DSH handles tool execution.',
        }),
        hooks: {
          PreToolUse: [{
            hooks: [async input => ({
              hookSpecificOutput: {
                hookEventName: 'PreToolUse',
                permissionDecision: input.hook_event_name === 'PreToolUse' && toolNames.has(input.tool_name)
                  ? 'defer' : 'deny',
                permissionDecisionReason: 'DSH handles tool execution.',
              },
            })],
          }],
        },
        extraArgs,
        onAuthExpired: () => { failedAuth = true; },
      }, auth);

      for await (const chunk of readResponse(session.events, toolNames, signal)) {
        if (chunk.type === 'finish') finish = chunk;
        else yield chunk;
      }
    } catch (error) {
      if (signal.aborted) {
        finish = { type: 'finish', reason: { kind: 'aborted', failure: { code: 'ABORTED', message: 'Qoder 请求已取消。' } } };
      } else {
        const needsLogin = failedAuth ||
          (error instanceof ControlRequestError && error.message.startsWith('Authentication required.'));
        const diagnostic = needsLogin ? authError() : error instanceof LlmError ? error
          : new LlmError('无法完成 Qoder 请求，请检查 Qoder CLI 版本及连接。', 'TRANSPORT');
        finish = { type: 'finish', reason: { kind: 'error', failure: diagnostic.failure } };
      }
    } finally {
      signal.removeEventListener('abort', abort);
      try {
        await session?.close();
      } finally {
        if (cwd) await rm(cwd, { recursive: true, force: true });
      }
    }
    if (finish) yield finish;
  }
}

class QoderAccountSettings extends TypertRemoteService {
  constructor(
    ctx: Context,
    private readonly readAccounts: (refresh: boolean) => Promise<AccountView[]>,
    private readonly browserLogin: (action: LoginAction) => Promise<LoginView>,
    private readonly changeAccount: (change: AccountChange) => Promise<boolean>,
  ) {
    super(ctx, accountService);
    ctx.effect(() => ctx.typert.register({
      package: name, face: 'host', schemas: [], invocations: contribution.descriptors,
      model: { services: [], events: [], objects: [] },
    }));
  }

  @Remote
  async login(action: LoginAction): Promise<LoginView> {
    if (this.ctx.invocation?.peer.principal.kind !== 'owner') return { state: 'failed' };
    return this.browserLogin(action);
  }

  @Remote
  async list(refresh: boolean) {
    if (this.ctx.invocation?.peer.principal.kind !== 'owner') return [];
    return this.readAccounts(refresh);
  }

  @Remote
  async change(change: unknown): Promise<boolean> {
    if (this.ctx.invocation?.peer.principal.kind !== 'owner') return false;
    try {
      return await this.changeAccount(parseAccountChange(change));
    } catch {
      return false;
    }
  }
}

export function apply(ctx: Context, config: PluginConfig = {}): void {
  const adapter = new QoderAdapter(config, openQoderSession, readQoderModels,
    async ref => {
      const credentials = ctx.get('credentials');
      return credentials ? (await credentials.resolve(credentialRef(ref)))?.value : process.env[ref];
    }, () => ctx.get('credentials'), () => ctx.get('attachments'));
  let live = true;
  const login = new BrowserLogin(() => {
    adapter.accounts.invalidate('QODER_PERSONAL_ACCESS_TOKEN');
    void check('qoder', true).catch(() => {});
  });
  const available = new Map<string, string>();
  const checks = new Map<string, object>();
  let registration: ReturnType<Context['llm']['registerAdapter']> | undefined;
  let directory = Promise.resolve();
  ctx.effect(() => () => {
    live = false;
    login.cancel();
    adapter.dispose();
  });

  function publish() {
    const routes = [...available.keys()];
    if (registration) registration.replace(routes);
    else if (routes.length) registration = ctx.llm.registerAdapter(routes, adapter);
  }

  async function check(provider: string, refresh = false): Promise<AccountView> {
    const ticket = {};
    checks.set(provider, ticket);
    const result = await adapter.accounts.statusOf(provider);
    if (live && checks.get(provider) === ticket && adapter.providers.includes(provider)) {
      const label = result.state === 'connected' ? adapter.providerInfo(provider).name : undefined;
      if (label !== available.get(provider)) {
        if (label) available.set(provider, label);
        else available.delete(provider);
        publish();
      } else if (label && refresh) {
        ctx.emit('llm/models-updated', provider);
      }
    }
    return result;
  }

  async function reloadDirectory(): Promise<void> {
    const next = directory.then(() => adapter.accounts.reload());
    directory = next.catch(() => {});
    await next;
  }

  async function readAccounts(refresh: boolean): Promise<AccountView[]> {
    await reloadDirectory();
    if (!live) return [];
    const providers = new Set(adapter.providers);
    let changed = false;
    for (const provider of checks.keys()) {
      if (providers.has(provider)) continue;
      checks.delete(provider);
      if (available.delete(provider)) changed = true;
    }
    if (changed) publish();
    if (refresh) adapter.accounts.invalidate();
    return Promise.all([...providers].map(provider => check(provider, refresh)));
  }

  async function changeAccount(change: AccountChange): Promise<boolean> {
    await reloadDirectory();
    if (!live) return false;
    return adapter.accounts.change(change);
  }

  function refreshDirectory() {
    void readAccounts(false).catch(() => {});
  }

  ctx.provide('dshQoderAccountUsage', { read: (provider: string, signal: AbortSignal) => adapter.usage(provider, signal) });
  ctx.on('credentials/reference-updated', ref => {
    const routes = adapter.accounts.invalidate(ref);
    let changed = false;
    for (const provider of routes) {
      if (available.delete(provider)) changed = true;
    }
    if (changed) publish();
    refreshDirectory();
  });
  ctx.on('credentials/record-updated', key => {
    if (isQoderAccountRecord(key)) refreshDirectory();
  });
  ctx.inject(['typert'], child => { new QoderAccountSettings(child, readAccounts, async action => {
    if (action === 'status') return login.view;
    if (action === 'cancel') return login.cancel();
    try {
      const path = await resolveCli(config.cliPath);
      const auth = await adapter.accounts.auth('qoder');
      if (live && auth.type === 'qodercli') return login.start(path);
    } catch { /* Report a recoverable failure without exposing CLI output. */ }
    return { state: 'failed' };
  }, changeAccount); });
  ctx.inject(['credentials'], refreshDirectory);
  refreshDirectory();
}
