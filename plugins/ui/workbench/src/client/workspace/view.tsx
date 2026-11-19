import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client';

/** Keep native search, archive and third-party row extensions available on demand. */
export function registerWorkspaceView(ctx: Context, register: () => () => void, onNative: () => void) {
  const listeners = new Set<() => void>();
  let native = false;
  let disposeTree: (() => void) | undefined;
  const view = {
    getSnapshot: () => native,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
  const toggle = () => {
    if (native) disposeTree = ctx.slots.inject('sidebar.workspaces', register);
    else { onNative(); disposeTree?.(); disposeTree = undefined; }
    native = !native;
    for (const listener of listeners) listener();
  };
  ctx.effect(() => {
    disposeTree = ctx.slots.inject('sidebar.workspaces', register);
    return () => disposeTree?.();
  });
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action', id: 'dsh-workbench:workspace-view', locale: 'workbench',
    inject: () => ({ toggle, goHome: () => ctx.layout.selectPanel(null), hooks: { view } }),
  }, ({ t, toggle, goHome, useView, usePanelInfo }) => {
    const home = usePanelInfo(info => info.activePanelId === null);
    const label = t(useView(current => current) ? 'showWorkbench' : 'showNative');
    if (!home) return <button type="button" className="wb-control" data-workbench-home-fallback onClick={goHome}>
      {t('conversation')}
    </button>;
    return <button type="button" className="wb-tree-action wb-tree-view" aria-label={label} title={label} onClick={toggle}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M5 7h14l-3-3m3 13H5l3 3M19 7l-3 3M5 17l3-3" />
      </svg>
    </button>;
  }));
  return { native: view, showWorkbench() { if (native) toggle(); } };
}
