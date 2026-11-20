import type { Context } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
import { LlmAdapter, LlmError, ReasoningEffortId, attributionHeaders } from '@deepseek-ai/dsh-llm';
import type { BuiltinLlmFailureCode, GenerateOptions, LlmResolvedModelInfo, PreparedAdapterCall, StreamChunk } from '@deepseek-ai/dsh-llm';
import { codexHome, loadCredential, loadModels } from './local.js';
import type { Config as PluginConfig } from './local.js';
import { systemProxy } from './proxy.js';
import { fetch as proxyFetch, type ProxyAgent } from 'undici';
import { buildRequest } from './request.js';
import { parseStream } from './stream.js';
import { readCodexUsage } from './usage.js';
import { unwatchFile, watchFile } from 'node:fs';
import { isAbsolute, join } from 'node:path';
export type { Config as PluginConfig } from './local.js';
export const name = 'dsh-codex';
export const inject = ['llm'];
export const Config: Schema<PluginConfig> = Schema.object({
  codexHome: Schema.string().description('Codex 配置目录，默认 CODEX_HOME 或 ~/.codex'),
  codexPath: Schema.string().description('额度查询使用的 Codex CLI 绝对路径，省略时从 PATH 查找。'),
  models: Schema.union([Schema.const(undefined), Schema.array(Schema.object({
    id: Schema.string().required(), name: Schema.string(),
    contextWindow: Schema.number().min(1), efforts: Schema.array(Schema.string()), defaultEffort: Schema.string(),
  }))]).description('显式模型列表；省略时读取 Codex models_cache.json'),
});
export const RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses';
export class CodexAdapter extends LlmAdapter {
  private readonly home: string;
  private readonly config: PluginConfig;
  private readonly lifetime = new AbortController();
  constructor(config: PluginConfig = {}, private readonly fetchImpl: typeof fetch = fetch) {
    super(); this.config = structuredClone(config); this.home = codexHome(this.config);
    if (config.codexPath && !isAbsolute(config.codexPath)) {
      throw new LlmError('Codex CLI 路径必须为绝对路径。', 'INVALID_CONFIG');
    }
  }
  usage(provider: string, signal: AbortSignal) {
    if (provider !== 'codex') return Promise.resolve(null);
    return readCodexUsage(this.config.codexPath ?? 'codex', this.home, AbortSignal.any([signal, this.lifetime.signal]));
  }
  async connected(): Promise<boolean> {
    try {
      await loadCredential(this.home);
      return true;
    } catch {
      return false;
    }
  }
  dispose(): void { this.lifetime.abort(); }
  override providerInfo(provider: string) { return { id: provider, name: 'Codex' }; }
  override async listModels(provider: string): Promise<LlmResolvedModelInfo[]> {
    return await this.connected() ? this.modelCatalog(provider) : [];
  }
  private async modelCatalog(provider: string): Promise<LlmResolvedModelInfo[]> {
    return (await loadModels(this.home, this.config.models)).map(m => ({ provider, id: m.id, name: m.name ?? m.id,
      inputModalities: ['text'], ...(m.contextWindow ? { context: { contextWindow: m.contextWindow } } : {}),
      ...(m.efforts?.length ? { reasoning: {
        ...(m.defaultEffort && m.efforts.includes(m.defaultEffort) ? { defaultEffort: ReasoningEffortId(m.defaultEffort) } : {}),
        efforts: m.efforts.map(e => ({ id: ReasoningEffortId(e), name: e })) } } : {}) }));
  }
  override async resolveModel(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo> {
    signal?.throwIfAborted();
    await loadCredential(this.home);
    const info = (await this.modelCatalog(provider)).find(m => m.id === model);
    signal?.throwIfAborted();
    if (!info) throw new LlmError('Codex 模型不在本地目录中，请更新 Codex 模型缓存或配置 models。', 'UNKNOWN_MODEL');
    return info;
  }
  override async prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<PreparedAdapterCall> {
    const resolved = await this.resolveModel(provider, model, signal);
    return { model: resolved, stream: options => this.streamResolved(options, resolved) };
  }
  override stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    return this.streamResolved(options);
  }
  private async *streamResolved(options: GenerateOptions, prepared?: LlmResolvedModelInfo): AsyncGenerator<StreamChunk> {
    const signal = AbortSignal.any([this.lifetime.signal, ...(options.signal ? [options.signal] : [])]);
    let dispatcher: ProxyAgent | undefined;
    try {
      signal.throwIfAborted();
      const model = prepared ?? await this.resolveModel(options.provider, options.model, signal);
      if (options.reasoningEffort && !model.reasoning?.efforts.some(e => e.id === options.reasoningEffort)) {
        throw new LlmError('所选模型未声明该推理强度。', 'UNSUPPORTED_OPTION');
      }
      const body = buildRequest(options);
      const credential = await loadCredential(this.home);
      signal.throwIfAborted();
      if (this.fetchImpl === fetch) dispatcher = await systemProxy(new URL(RESPONSES_URL).hostname, signal);
      const init = { method: 'POST', signal,
        headers: { authorization: `Bearer ${credential.accessToken}`, 'chatgpt-account-id': credential.accountId,
          originator: 'codex_cli_rs', 'content-type': 'application/json', accept: 'text/event-stream', ...attributionHeaders() },
        body: JSON.stringify(body), redirect: 'error' as const };
      const response = dispatcher ? await proxyFetch(RESPONSES_URL, { ...init, dispatcher }) : await this.fetchImpl(RESPONSES_URL, init);
      if (!response.ok) {
        await response.body?.cancel();
        const code: BuiltinLlmFailureCode = response.status === 401 || response.status === 403 ? 'AUTH' : response.status === 429 ? 'RATE_LIMIT' : response.status >= 500 ? 'SERVER' : `HTTP_${response.status}`;
        throw new LlmError(code === 'AUTH' ? 'Codex 登录失效或无访问权限，请运行 codex login。' : `Codex 请求失败（HTTP ${response.status}）。`, code, { status: response.status });
      }
      if (!response.body) throw new LlmError('Codex 响应没有数据流。', 'INVALID_RESPONSE');
      yield* parseStream(response.body);
    } catch (error) {
      const aborted = signal.aborted;
      const failure = error instanceof LlmError ? error.failure : { code: 'TRANSPORT', message: 'Codex 网络请求失败，请检查连接。' };
      yield { type: 'finish', reason: { kind: aborted ? 'aborted' : 'error', failure: aborted ? { code: 'ABORTED', message: 'Codex 请求已取消。' } : failure } };
    } finally {
      await dispatcher?.destroy();
    }
  }
}
export function apply(ctx: Context, config: PluginConfig = {}): void {
  const adapter = new CodexAdapter(config);
  ctx.effect(() => () => adapter.dispose());
  ctx.llm.registerAdapter(['codex'], adapter);
  ctx.provide('dshCodexAccountUsage', {
    read: (provider: string, signal: AbortSignal) => adapter.usage(provider, signal),
    connected: () => adapter.connected(),
  });
  const files = ['auth.json', 'models_cache.json'].map(file => join(codexHome(config), file));
  const refresh = () => { ctx.emit('llm/models-updated', 'codex'); };
  ctx.effect(() => {
    for (const path of files) watchFile(path, { persistent: false, interval: 1000 }, refresh);
    return () => { for (const path of files) unwatchFile(path, refresh); };
  });
}
