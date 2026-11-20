import { ReasoningEffortId } from '@deepseek-ai/dsh-llm';
import type { LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm';
import type { CatalogModel } from './local.js';

export function describeModel(provider: string, model: CatalogModel, hasAttachments: boolean): LlmResolvedModelInfo {
  const declared = model.inputModalities;
  const image = hasAttachments && !!declared?.includes('image');
  const notes: string[] = [];
  if (model.description) notes.push(model.description);
  if (declared === undefined) {
    notes.push('输入模态未披露，当前接入仅发送文本。');
  } else {
    const source = model.modalitySource === 'config' ? '本机配置' : 'Codex 模型缓存';
    notes.push(`${source}声明输入：${declared.join('、')}。`);
    if (declared.includes('image') && !hasAttachments) notes.push('宿主附件服务不可用，当前仅发送文本。');
    const unsupported = declared.filter(value => value !== 'image' && value !== 'text');
    if (unsupported.length) notes.push(`当前接入尚未传递：${unsupported.join('、')}。`);
  }
  if (model.contextWindow) {
    const context = [`当前窗口 ${model.contextWindow}`];
    if (model.maxContextWindow) context.push(`缓存最大窗口 ${model.maxContextWindow}`);
    if (model.effectiveContextPercent) context.push(`缓存有效比例 ${model.effectiveContextPercent}%`);
    notes.push(context.join('，') + '。');
  }
  if (model.supportsOriginalDetail) notes.push('图片使用宿主规范化版本，当前未请求 original 细节。');
  if (model.defaultSummary) notes.push(`目录默认推理摘要 ${model.defaultSummary}。`);
  if (model.defaultVerbosity) notes.push(`目录默认详略 ${model.defaultVerbosity}。`);
  if (model.serviceTiers?.length) notes.push(`目录服务档位 ${model.serviceTiers.join('、')}，当前使用服务端默认档位。`);
  notes.push('输出预算由 Codex 管理，支持文本输出和 DSH 函数工具。');
  return {
    provider, id: model.id, name: model.name ?? model.id,
    description: notes.join(' '),
    badge: image
      ? { tone: 'info', text: { en: 'Image input', zh: '可发图片' } }
      : { tone: 'neutral', text: { en: 'Text input', zh: '仅文本' } },
    inputModalities: image ? ['text', 'image'] : ['text'],
    ...(model.contextWindow && { context: { contextWindow: model.contextWindow } }),
    ...(model.efforts?.length && { reasoning: {
      ...(model.defaultEffort && model.efforts.includes(model.defaultEffort)
        && { defaultEffort: ReasoningEffortId(model.defaultEffort) }),
      efforts: model.efforts.map(effort => ({
        id: ReasoningEffortId(effort), name: effort,
        ...(model.effortDescriptions?.[effort] && { description: model.effortDescriptions[effort] }),
      })),
    } }),
  };
}
