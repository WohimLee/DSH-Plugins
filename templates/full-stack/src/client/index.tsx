import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client';
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client';
import { createElement } from 'react';

export const inject = ['slots'];
const panelId = 'dsh-{{slug}}' as MainPanelId;
function Panel() {
  return createElement('section', { 'aria-label': '{{slug}}', style: { padding: 24 } },
    createElement('h1', null, '{{slug}}'),
    createElement('p', null, '插件页面已加载。请用实际功能替换示例。'));
}
function Icon() { return createElement('span', { 'aria-hidden': true }, '◇'); }
export function apply(ctx: Context): void {
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: panelId }, Panel));
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist', id: panelId, label: () => '{{slug}}', order: 100,
  }, Icon));
}
