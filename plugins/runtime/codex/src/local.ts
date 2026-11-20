import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { LlmError } from '@deepseek-ai/dsh-llm';

export interface ModelConfig {
  id: string;
  name?: string;
  contextWindow?: number;
  efforts?: string[];
  defaultEffort?: string;
  inputModalities?: string[];
}
export interface CatalogModel extends ModelConfig {
  description?: string;
  effortDescriptions?: Record<string, string>;
  maxContextWindow?: number;
  effectiveContextPercent?: number;
  supportsOriginalDetail?: boolean;
  defaultSummary?: string;
  defaultVerbosity?: string;
  serviceTiers?: string[];
  modalitySource?: 'cache' | 'config';
}
export interface Config { codexHome?: string; codexPath?: string; models?: ModelConfig[] }
export const codexHome = (config: Config): string => config.codexHome ?? process.env.CODEX_HOME ?? join(homedir(), '.codex');
export const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export async function readJson(path: string): Promise<unknown> {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return undefined; }
}
export async function loadCredential(home: string): Promise<{ accessToken: string; accountId: string }> {
  const auth = record(await readJson(join(home, 'auth.json')));
  const tokens = record(auth.tokens);
  if (auth.auth_mode === 'apikey' || typeof tokens.access_token !== 'string' || !tokens.access_token.trim()
    || typeof tokens.account_id !== 'string' || !tokens.account_id.trim()) {
    throw new LlmError('未找到可用的 Codex OAuth 登录文件，请在同一用户环境运行 codex login；系统钥匙串登录暂不支持。', 'AUTH');
  }
  // Never retain or write refresh/id tokens; CLI owns the login lifecycle.
  return { accessToken: tokens.access_token, accountId: tokens.account_id };
}
export async function loadModels(home: string, configured?: ModelConfig[]): Promise<CatalogModel[]> {
  return modelsFromCache(await readJson(join(home, 'models_cache.json')), configured);
}
export function modelsFromCache(value: unknown, configured?: ModelConfig[]): CatalogModel[] {
  const cache = record(value);
  const models = new Map<string, CatalogModel>();
  for (const raw of Array.isArray(cache.models) ? cache.models : []) {
    const m = record(raw);
    if (typeof m.slug !== 'string' || !m.slug.trim() || m.visibility !== 'list' || m.supported_in_api !== true) continue;
    const descriptions: [string, string][] = [];
    const efforts = Array.isArray(m.supported_reasoning_levels) ? m.supported_reasoning_levels.flatMap(raw => {
      const { effort, description } = record(raw);
      if (typeof effort === 'string' && typeof description === 'string') descriptions.push([effort, description]);
      return typeof effort === 'string' && effort.trim() ? [effort] : [];
    }) : [];
    models.set(m.slug, { id: m.slug, name: typeof m.display_name === 'string' ? m.display_name : m.slug,
      ...(typeof m.context_window === 'number' && Number.isFinite(m.context_window) && m.context_window > 0 ? { contextWindow: m.context_window } : {}),
      ...(typeof m.default_reasoning_level === 'string' && efforts.includes(m.default_reasoning_level)
        ? { defaultEffort: m.default_reasoning_level } : {}),
      ...(typeof m.description === 'string' && { description: m.description }),
      ...(descriptions.length > 0 && { effortDescriptions: Object.fromEntries(descriptions) }),
      ...(Array.isArray(m.input_modalities) && m.input_modalities.every(value => typeof value === 'string')
        && { inputModalities: [...new Set<string>(m.input_modalities)], modalitySource: 'cache' }),
      ...(Number.isSafeInteger(m.max_context_window) && Number(m.max_context_window) > 0 && { maxContextWindow: Number(m.max_context_window) }),
      ...(typeof m.effective_context_window_percent === 'number' && m.effective_context_window_percent > 0
        && m.effective_context_window_percent <= 100 && { effectiveContextPercent: m.effective_context_window_percent }),
      ...(m.supports_image_detail_original === true && { supportsOriginalDetail: true }),
      ...(typeof m.default_reasoning_summary === 'string' && { defaultSummary: m.default_reasoning_summary }),
      ...(typeof m.default_verbosity === 'string' && { defaultVerbosity: m.default_verbosity }),
      ...(Array.isArray(m.service_tiers) && { serviceTiers: m.service_tiers.flatMap(raw => {
        const id = record(raw).id;
        return typeof id === 'string' ? [id] : [];
      }) }),
      efforts: [...new Set(efforts)] });
  }
  if (configured === undefined) return [...models.values()];
  return configured.map(model => ({
    ...models.get(model.id),
    ...structuredClone(model),
    ...(model.inputModalities !== undefined && { modalitySource: 'config' as const }),
  }));
}
