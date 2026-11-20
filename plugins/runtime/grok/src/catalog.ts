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
export type GrokModel = Model<'openai-responses'> & { defaultEffort?: ReasoningEffortId };
const languageModels = z.object({
  models: z.array(z.object({
    id: modelId,
    aliases: z.array(modelId).optional(),
    context_length: positive.optional(),
    max_output_tokens: positive.optional(),
    input_modalities: z.array(z.string()),
    output_modalities: z.array(z.string()),
    capabilities: z.object({
      reasoning_effort: z.array(z.string()).optional(),
      default_reasoning_effort: z.string().optional(),
    }).optional(),
    prompt_text_token_price: price,
    completion_text_token_price: price,
    cached_prompt_text_token_price: price,
  })),
});
const modelDetails = z.object({
  data: z.array(z.object({ id: modelId, context_length: positive.optional(), max_output_tokens: positive.optional() })),
});

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
  const chat = models.filter(model => model.input_modalities.includes('text') && model.output_modalities.includes('text'));
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
    const extra = details?.get(model.id);
    const efforts = model.capabilities?.reasoning_effort ?? [];
    const supported = effortLevels.filter(level => efforts.includes(level === 'off' ? 'none' : level));
    const thinkingLevelMap: ThinkingLevelMap = Object.fromEntries(effortLevels.map(level => [
      level, supported.includes(level) ? (level === 'off' ? 'none' : level) : null,
    ]));
    const defaultEffort = supported.find(level => thinkingLevelMap[level] === model.capabilities?.default_reasoning_effort);
    const millionTokenPrice = (value: number | undefined, fallback = 0) => value === undefined ? fallback : value / 10_000;
    unique.set(model.id, {
      ...known,
      id: model.id,
      name: known?.name ?? (model.id === 'latest' ? aliases.find(alias => alias.startsWith('grok-')) : undefined) ?? model.id,
      provider: route,
      api: 'openai-responses',
      baseUrl,
      input: model.input_modalities.includes('image') ? ['text', 'image'] : ['text'],
      contextWindow: model.context_length ?? extra?.context_length ?? known?.contextWindow ?? 131_072,
      maxTokens: model.max_output_tokens ?? extra?.max_output_tokens ?? known?.maxTokens ?? 16_384,
      reasoning: supported.length > 0,
      thinkingLevelMap,
      ...(defaultEffort && { defaultEffort: ReasoningEffortId(defaultEffort) }),
      compat: { supportsLongCacheRetention: false },
      cost: {
        input: millionTokenPrice(model.prompt_text_token_price, known?.cost.input),
        output: millionTokenPrice(model.completion_text_token_price, known?.cost.output),
        cacheRead: millionTokenPrice(model.cached_prompt_text_token_price, known?.cost.cacheRead),
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
