import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';
import type {} from '../messages.js';
import { Glyph } from '../workspace/Glyph.js';

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

const filtered = 'data-workbench-plugin-filtered';
const groupsSelector = ':is([data-plugin-group="basic"], [data-plugin-group="extensions"], [data-plugin-group="bundles"])';
const rowsSelector = ':scope > ul > :is([data-plugin-item], [data-plugin-package])';
const normalize = (text: string) => text.normalize('NFKC').toLocaleLowerCase();

export function PluginsNavigation({ label, openList, t }: Props) {
  const nav = useRef<HTMLElement>(null);
  const [selected, setSelected] = useState<Group>('overview');
  const [query, setQuery] = useState('');
  const [searchSite, setSearchSite] = useState<HTMLDivElement>();
  const [empty, setEmpty] = useState(false);
  const criteria = useRef({ group: selected, query });
  const syncFilters = useRef<() => void>();
  const pendingScroll = useRef(false);

  useLayoutEffect(() => {
    const frame = nav.current?.closest('[data-slot="root"] > div');
    if (!frame) return;
    const site = frame.ownerDocument.createElement('div');
    site.setAttribute('data-workbench-plugin-search', '');
    let hidden = new Set<Element>();

    function applyHidden(next: Set<Element>) {
      for (const element of hidden) if (!next.has(element)) element.removeAttribute(filtered);
      for (const element of next) if (!hidden.has(element)) element.setAttribute(filtered, '');
      hidden = next;
    }

    const sync = () => {
      const panel = frame.querySelector('[data-slot="main"] [data-plugin-panel]');
      const body = panel?.querySelector<HTMLElement>('[data-plugin-body]');
      const bar = body?.querySelector(':scope > [data-plugin-bar]:not([aria-hidden="true"])');
      const toolbar = bar?.querySelector<HTMLElement>('[data-plugin-toolbar]');
      // Only the native installed overview has the toolbar and managed groups.
      if (!body || !bar || !toolbar || toolbar.hidden) {
        site.remove();
        setSearchSite(undefined);
        applyHidden(new Set());
        return;
      }
      if (bar.nextElementSibling !== site) bar.after(site);
      setSearchSite(site);
      if (pendingScroll.current) {
        body.scrollTop = 0;
        pendingScroll.current = false;
      }
      const { group, query } = criteria.current;
      const terms = normalize(query.trim()).split(/\s+/).filter(Boolean);
      const next = new Set<Element>();
      let matches = false;
      for (const section of body.querySelectorAll(groupsSelector)) {
        if (group !== 'overview' && section.getAttribute('data-plugin-group') !== group) {
          next.add(section);
          continue;
        }
        let hasMatch = terms.length === 0;
        for (const row of section.querySelectorAll(rowsSelector)) {
          const searchable = normalize([row.textContent, row.getAttribute('data-plugin-item'), row.getAttribute('data-plugin-package')].join(' '));
          if (terms.every(term => searchable.includes(term))) hasMatch = true;
          else next.add(row);
        }
        if (hasMatch) matches = true;
        else next.add(section);
      }
      applyHidden(next);
      setEmpty(!matches && (terms.length > 0 || group !== 'overview') && panel?.getAttribute('aria-busy') !== 'true');
    };
    syncFilters.current = sync;
    const observer = new MutationObserver(sync);
    observer.observe(frame, {
      subtree: true, childList: true, characterData: true, attributes: true,
      attributeFilter: ['hidden', 'aria-busy'],
    });
    sync();
    return () => {
      observer.disconnect();
      syncFilters.current = undefined;
      applyHidden(new Set());
      site.remove();
    };
  }, []);

  useLayoutEffect(() => {
    criteria.current = { group: selected, query };
    syncFilters.current?.();
  }, [selected, query]);

  function select(group: Group) {
    if (!openList()) return;
    pendingScroll.current = true;
    if (selected === group) syncFilters.current?.();
    else setSelected(group);
  }

  return <><nav ref={nav} className="wb-plugins-navigation" data-workbench-plugins-navigation aria-label={label}>
    <div className="wb-plugins-navigation-title">{label}</div>
    {groups.map(([group, key, path]) => <button key={group} type="button" data-workbench-plugin-group={group}
      aria-current={selected === group ? 'true' : undefined}
      onClick={() => select(group)}>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
        strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={path} /></svg>
      {t(key)}
    </button>)}
  </nav>
  {searchSite && createPortal(<>
    <label className="wb-plugin-search-field">
      <Glyph icon="search" />
      <input type="search" aria-label={t('pluginsSearch')} placeholder={t('pluginsSearch')}
        value={query} onChange={event => setQuery(event.currentTarget.value)} />
    </label>
    {empty && <p role="status">{t('pluginsNoMatches')}</p>}
  </>, searchSite)}
  </>;
}
