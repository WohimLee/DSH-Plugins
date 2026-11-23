import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client';
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';

type Route = ModelDirectoryState['groups'][number];
export interface ProviderGroup {
  id: string;
  name: string;
  routes: Route[];
}

export function groupProviders(routes: readonly Route[]): ProviderGroup[] {
  const groups = new Map<string, ProviderGroup>();
  for (const route of routes) {
    const { id, name } = route.id === 'deepseek-account' || route.id === 'deepseek-official' || route.id.startsWith('deepseek-api-account-')
      ? { id: 'deepseek', name: 'DeepSeek' }
      : route.id === 'qoder' || route.id.startsWith('qoder-account-')
        ? { id: 'qoder', name: 'Qoder' }
        : route.id.startsWith('codex-account-') || route.id.startsWith('codex-api-account-') ? { id: 'codex', name: 'Codex' }
          : route.id.startsWith('grok-account-') ? { id: 'grok', name: 'Grok' }
            : route;
    const group = groups.get(id) ?? { id, name, routes: [] };
    group.routes.push(route);
    groups.set(id, group);
  }
  return [...groups.values()].sort((a, b) => Number(b.id === 'deepseek') - Number(a.id === 'deepseek'));
}

export function activeRoute(group: ProviderGroup, preferred?: string): Route {
  return group.routes.find(route => route.id === preferred)
    ?? group.routes.find(route => route.id === 'deepseek-account')
    ?? group.routes[0];
}

export function routeName(route: Route, t: PropsLocale<'modelPicker'>['t']): string {
  if (route.id === 'deepseek-account') return t('deepseekAccount');
  if (route.id === 'deepseek-official') return t('deepseekKey');
  if (route.id === 'qoder') return t('defaultAccount');
  if (route.id === 'codex' || route.id === 'grok') return t('defaultAccount');
  return route.name.replace(/^(?:Qoder|Codex|Grok|DeepSeek) · /, '');
}
