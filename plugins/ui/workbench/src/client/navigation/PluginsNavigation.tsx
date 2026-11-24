import { useEffect, useRef, useState } from 'react';
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';
import type {} from '../messages.js';

const groups = [
  ['overview', 'pluginsOverview', 'M3 3h4v4H3zm6 0h4v4H9zM3 9h4v4H3zm6 0h4v4H9z'],
  ['basic', 'pluginsBuiltIn', 'M2 5h12M2 11h12M6 3v4M10 9v4'],
  ['extensions', 'pluginsExperimental', 'M6 2h4m-3 0v5l-4 5.5a1 1 0 0 0 .8 1.5h8.4a1 1 0 0 0 .8-1.5L9 7V2M5 10h6'],
  ['bundles', 'pluginsInstalled', 'm8 2 5.5 3v6L8 14l-5.5-3V5L8 2Zm0 6 5.5-3M8 8 2.5 5M8 8v6'],
] as const;
type Group = typeof groups[number][0];

type Props = PropsLocale<'workbench'> & {
  label: string;
  openList: () => boolean;
};

export function PluginsNavigation({ label, openList, t }: Props) {
  const nav = useRef<HTMLElement>(null);
  const [selected, setSelected] = useState<Group>('overview');
  const [request, setRequest] = useState<{ group: Group }>();

  useEffect(() => {
    if (!request) return;
    const frame = nav.current?.closest('[data-slot="root"] > div');
    const panel = frame?.querySelector('[data-slot="main"] [data-plugin-panel]');
    if (!panel) return;
    const { group } = request;

    function jump() {
      const body = panel?.querySelector<HTMLElement>('[data-plugin-body]');
      if (!body) return false;
      const target = group === 'overview' ? null : body.querySelector<HTMLElement>(`[data-plugin-group="${group}"]`);
      if (group !== 'overview' && !target) return false;
      const scrollPadding = Number.parseFloat(getComputedStyle(body).scrollPaddingTop) || 0;
      body.scrollTop = target
        ? body.scrollTop + target.getBoundingClientRect().top - body.getBoundingClientRect().top - scrollPadding
        : 0;
      setSelected(group);
      return true;
    }

    if (jump()) return;
    const observer = new MutationObserver(() => { if (jump()) observer.disconnect(); });
    observer.observe(panel, { subtree: true, childList: true });
    return () => observer.disconnect();
  }, [request]);

  return <nav ref={nav} className="wb-plugins-navigation" data-workbench-plugins-navigation aria-label={label}>
    <div className="wb-plugins-navigation-title">{label}</div>
    {groups.map(([group, key, path]) => <button key={group} type="button" data-workbench-plugin-group={group}
      aria-current={selected === group ? 'true' : undefined}
      onClick={() => { if (openList()) setRequest({ group }); }}>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
        strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={path} /></svg>
      {t(key)}
    </button>)}
  </nav>;
}
