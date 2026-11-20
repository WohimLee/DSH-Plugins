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
export async function loadModels(home: string, configured?: ModelConfig[]): Promise<ModelConfig[]> {
  if (configured !== undefined) return structuredClone(configured);
  const cache = record(await readJson(join(home, 'models_cache.json')));
  if (!Array.isArray(cache.models)) return [];
  const models = new Map<string, ModelConfig>();
  for (const raw of cache.models) {
    const m = record(raw);
    if (typeof m.slug !== 'string' || !m.slug.trim() || m.visibility !== 'list' || m.supported_in_api !== true) continue;
    const efforts = Array.isArray(m.supported_reasoning_levels) ? m.supported_reasoning_levels.flatMap(raw => {
      const effort = record(raw).effort;
      return typeof effort === 'string' && effort.trim() ? [effort] : [];
    }) : [];
    models.set(m.slug, { id: m.slug, name: typeof m.display_name === 'string' ? m.display_name : m.slug,
      ...(typeof m.context_window === 'number' && Number.isFinite(m.context_window) && m.context_window > 0 ? { contextWindow: m.context_window } : {}),
      ...(typeof m.default_reasoning_level === 'string' && efforts.includes(m.default_reasoning_level)
        ? { defaultEffort: m.default_reasoning_level } : {}),
      efforts: [...new Set(efforts)] });
  }
  return [...models.values()];
}
