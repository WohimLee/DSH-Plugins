import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client';

type Route = ModelDirectoryState['groups'][number];
export interface ProviderGroup {
  id: string;
  name: string;
  routes: Route[];
}

export function groupProviders(routes: readonly Route[]): ProviderGroup[] {
  const groups = new Map<string, ProviderGroup>();
  for (const route of routes) {
    const { id, name } = route.id === 'deepseek-account' || route.id === 'deepseek-official'
      ? { id: 'deepseek', name: 'DeepSeek' }
      : route.id === 'qoder' || route.id.startsWith('qoder-account-')
        ? { id: 'qoder', name: 'Qoder' }
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
