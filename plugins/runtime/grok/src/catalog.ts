import { attributionHeaders, ReasoningEffortId } from '@deepseek-ai/dsh-llm';
import type { Model, ThinkingLevelMap } from '@earendil-works/pi-ai';
import { xaiProvider } from '@earendil-works/pi-ai/providers/xai';
import { z } from 'zod';
import { fetchGrok } from './transport.js';

export const route = 'grok';
const baseUrl = 'https://api.x.ai/v1';
const vendor = xaiProvider();
const knownModels = new Map(vendor.getModels().map(model => [model.id, model]));

const modelId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/);
const positive = z.number().int().positive();
const price = z.number().nonnegative().optional();
const effortLevels = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export type GrokModel = Model<'openai-responses'> & {
  defaultEffort?: ReasoningEffortId;
  capabilityDescription: string;
};

function capacity(primary: number | undefined, detail: number | undefined, builtIn: number | undefined, fallback: number) {
  if (primary !== undefined) return { value: primary, source: 'xAI language-models' };
  if (detail !== undefined) return { value: detail, source: 'xAI models' };
  if (builtIn !== undefined) return { value: builtIn, source: 'pi-ai 内置目录' };
  return { value: fallback, source: '插件回退值' };
}

function tokenPrice(remote?: number, builtIn?: number) {
  if (remote !== undefined) return { value: remote / 10_000, source: 'xAI' };
  if (builtIn !== undefined) return { value: builtIn, source: 'pi-ai 内置目录' };
  return { value: 0, source: '价格未知' };
}
// xAI can place the same model detail in either listing. Only the key-scoped
// language list determines admission to this route.
const detailFields = {
  id: modelId,
  context_length: positive.optional(),
  max_output_tokens: positive.optional(),
  capabilities: z.object({
    reasoning_effort: z.array(z.string()).optional(),
    default_reasoning_effort: z.string().optional(),
  }).optional(),
  prompt_text_token_price: price,
  completion_text_token_price: price,
  cached_prompt_text_token_price: price,
  prompt_image_token_price: price,
  long_context_threshold: z.number().int().nonnegative().optional(),
};
const languageModels = z.object({
  models: z.array(z.object({
    ...detailFields,
    aliases: z.array(modelId).optional(),
    input_modalities: z.array(z.string()).optional(),
    output_modalities: z.array(z.string()),
  })),
});
const modelDetails = z.object({ data: z.array(z.object(detailFields)) });

export class RejectedKey extends Error {}

async function request(path: string, key: string, signal: AbortSignal, transport: typeof fetch): Promise<unknown> {
  const response = await transport(baseUrl + path, {
    headers: { ...attributionHeaders(), authorization: `Bearer ${key}`, accept: 'application/json' },
    redirect: 'error',
    signal,
  });
  if (response.ok) return response.json();
  await response.body?.cancel().catch(() => {});
  if (response.status === 401 || response.status === 403) throw new RejectedKey();
  throw new Error('xAI model discovery failed');
}

export async function readCatalog(key: string, lifetime: AbortSignal, transport = fetchGrok): Promise<GrokModel[]> {
  const signal = AbortSignal.any([lifetime, AbortSignal.timeout(10_000)]);
  const { models } = languageModels.parse(await request('/language-models', key, signal, transport));
  const chat = models.filter(model => (model.input_modalities === undefined || model.input_modalities.includes('text')) && model.output_modalities.includes('text'));
  if (!chat.length) return [];
  // The language endpoint is authoritative for availability. The full listing can supply context sizes.
  const details = await request('/models', key, signal, transport)
    .then(value => new Map(modelDetails.parse(value).data.map(model => [model.id, model])))
    .catch(() => undefined);
  lifetime.throwIfAborted();
  const unique = new Map<string, GrokModel>();
  for (const model of chat) {
    const aliases = model.aliases ?? [];
    const known = knownModels.get(model.id) ?? aliases.map(alias => knownModels.get(alias)).find(Boolean);
    const extra = details?.get(model.id) ?? aliases.map(alias => details?.get(alias)).find(Boolean);
    const efforts = model.capabilities?.reasoning_effort ?? extra?.capabilities?.reasoning_effort ?? [];
    const reportedDefault = model.capabilities?.default_reasoning_effort ?? extra?.capabilities?.default_reasoning_effort;
    const supported = effortLevels.filter(level => efforts.includes(level === 'off' ? 'none' : level));
    const thinkingLevelMap: ThinkingLevelMap = Object.fromEntries(effortLevels.map(level => [
      level, supported.includes(level) ? (level === 'off' ? 'none' : level) : null,
    ]));
    const defaultEffort = supported.find(level => thinkingLevelMap[level] === reportedDefault);
    const input: GrokModel['input'] = model.input_modalities?.includes('image') ? ['text', 'image'] : ['text'];
    const context = capacity(model.context_length, extra?.context_length, known?.contextWindow, 131_072);
    const output = capacity(model.max_output_tokens, extra?.max_output_tokens, known?.maxTokens, 16_384);
    const promptPrice = tokenPrice(model.prompt_text_token_price ?? extra?.prompt_text_token_price, known?.cost.input);
    const completionPrice = tokenPrice(model.completion_text_token_price ?? extra?.completion_text_token_price, known?.cost.output);
    const cachePrice = tokenPrice(model.cached_prompt_text_token_price ?? extra?.cached_prompt_text_token_price, known?.cost.cacheRead);
    const description = [
      model.input_modalities ? `xAI 输入 ${model.input_modalities.join('、')}，插件可传 ${input.join('、')}` : 'xAI 未披露输入模态，当前接入仅接收文本',
      `xAI 输出 ${model.output_modalities.join('、')}，DSH 接收文本`,
      `上下文 ${context.value}（${context.source}），最大输出 ${output.value}（${output.source}）`,
      `价格来源（输入 / 输出 / 缓存读取）${[promptPrice, completionPrice, cachePrice].map(price => price.source).join(' / ')}`,
    ];
    const imagePrice = model.prompt_image_token_price ?? extra?.prompt_image_token_price;
    if (input.includes('image') && imagePrice !== undefined && imagePrice !== (model.prompt_text_token_price ?? extra?.prompt_text_token_price)) {
      description.push(`xAI 图片输入 $${imagePrice / 10_000}/百万 token，pi-ai 以文本单价估算`);
    }
    const threshold = model.long_context_threshold ?? extra?.long_context_threshold;
    if (threshold) description.push(`xAI 长上下文计价从 ${threshold} token 起，pi-ai 以基础单价估算`);
    const unused = efforts.filter(effort => !Object.values(thinkingLevelMap).includes(effort));
    if (unused.length) description.push(`当前接入未映射的推理档位 ${unused.join('、')}`);
    if (reportedDefault && !defaultEffort) description.push('xAI 默认推理档位未映射');

    unique.set(model.id, {
      ...known,
      id: model.id,
      name: known?.name ?? (model.id === 'latest' ? aliases.find(alias => alias.startsWith('grok-')) : undefined) ?? model.id,
      provider: route,
      api: 'openai-responses',
      baseUrl,
      input,
      capabilityDescription: description.join('。'),
      contextWindow: context.value,
      maxTokens: output.value,
      reasoning: supported.length > 0,
      thinkingLevelMap,
      ...(defaultEffort && { defaultEffort: ReasoningEffortId(defaultEffort) }),
      compat: { ...known?.compat, supportsLongCacheRetention: false },
      cost: {
        input: promptPrice.value,
        output: completionPrice.value,
        cacheRead: cachePrice.value,
        cacheWrite: 0,
      },
    });
  }
  return [...unique.values()];
}

export function grokProvider(models: readonly Model<'openai-responses'>[]): ReturnType<typeof xaiProvider> {
  return {
    ...vendor,
    id: route,
    name: 'Grok',
    getModels: () => models,
    // Use xAI's Responses compatibility. Auth comes exclusively from the validated DSH connection.
    auth: {
      apiKey: {
        name: 'xAI API key',
        resolve: async ({ credential }) => credential?.key ? { auth: { apiKey: credential.key }, source: 'Grok' } : undefined,
      },
    },
    stream: (model, context, options) => vendor.stream({ ...model, provider: 'xai' }, context, Object.assign({ fetch: fetchGrok }, options)),
    streamSimple: (model, context, options) => vendor.streamSimple({ ...model, provider: 'xai' }, context, Object.assign({ fetch: fetchGrok }, options)),
  };
}
