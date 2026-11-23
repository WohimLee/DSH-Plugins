import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { KeyboardEvent } from 'react';
import type { ModelDirectory, ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client';
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import { activeRoute, groupProviders, routeName } from './model.js';

type Route = ModelDirectoryState['groups'][number];
type Model = Route['models'][number];
type Props = Pick<PropsRuntime<'conversation.input.model.options'>, 'locked' | 'dismiss' | 'reportFailure'> & PropsLocale<'modelPicker'> & {
  directory: ModelDirectory;
  back: () => void;
};

const narrow = () => window.matchMedia('(max-width: 389px), (pointer: coarse)').matches;

export function Picker({ directory, locked, dismiss, reportFailure, back, t }: Props) {
  const state = useSyncExternalStore(directory.store.subscribe, directory.store.getSnapshot);
  const legacyQoder = state.current?.provider === 'qoder';
  const groups = useMemo(() => {
    const named = state.groups.some(route => route.id.startsWith('qoder-account-'));
    return groupProviders(named && !legacyQoder ? state.groups.filter(route => route.id !== 'qoder') : state.groups);
  }, [state.groups, legacyQoder]);
  const [provider, setProvider] = useState('');
  const [accounts, setAccounts] = useState<Record<string, string>>({});
  const [entered, setEntered] = useState(false);
  const [query, setQuery] = useState('');
  const [failed, setFailed] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const results = useRef<HTMLDivElement>(null);
  const id = useId();
  const group = groups.find(item => item.id === provider)
    ?? groups.find(item => item.routes.some(route => route.id === state.current?.provider)) ?? groups[0];
  const route = group && activeRoute(group, accounts[group.id] ?? state.current?.provider);
  const busy = locked || state.status === 'selecting';
  const term = query.trim().toLocaleLowerCase();
  const searching = term !== '';

  useLayoutEffect(() => {
    if (results.current) results.current.scrollTop = 0;
  }, [route?.id, searching]);

  useEffect(() => {
    let active = true;
    void directory.load().catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [directory]);

  const models = (term
    ? groups.flatMap(item => item.routes.map(route => ({ route, provider: item.name })))
    : route ? [{ route, provider: '' }] : [])
    .map(item => ({ ...item, models: item.route.models.filter(model => !term
      || [model.name, model.id, item.provider, item.route.name].some(name => name.toLocaleLowerCase().includes(term))) }))
    .filter(item => item.models.length > 0);

  function choose(route: Route, model: Model): void {
    if (busy) return;
    const same = state.current?.provider === route.id && state.current.model === model.id;
    const supported = model.reasoning?.efforts ?? [];
    const previous = state.current?.reasoningEffort;
    const fallback = model.reasoning?.defaultEffort;
    const effort = supported.find(level => level.id === previous)?.id
      ?? supported.find(level => level.id === fallback)?.id;
    if (same && (previous === effort || previous === undefined)) { dismiss(); return; }
    void directory.select({ provider: route.id, model: model.id, ...(effort === undefined ? {} : { reasoningEffort: effort }) })
      .then(result => { if (result.ok) dismiss(); else reportFailure(t('selectionFailed')); })
      .catch(() => reportFailure(t('selectionFailed')));
  }

  function focusRow(selector: string, direction: number, from?: EventTarget): void {
    const rows = Array.from(root.current?.querySelectorAll<HTMLButtonElement>(selector) ?? [])
      .filter(row => row.getClientRects().length > 0 && !row.disabled);
    if (rows.length === 0) return;
    const index = rows.findIndex(row => row === from);
    const start = index < 0 && direction < 0 ? 0 : index;
    rows[(start + direction + rows.length) % rows.length]?.focus();
  }

  function keys(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Tab') {
      const controls = Array.from(root.current?.querySelectorAll<HTMLElement>('input, select, button:not(:disabled)') ?? [])
        .filter(node => node.getClientRects().length > 0);
      const index = controls.findIndex(node => node === event.target);
      if (controls[index + (event.shiftKey ? -1 : 1)]) event.stopPropagation();
      return;
    }
    if (event.key === 'Escape' && (!narrow() || !entered || term)) {
      event.preventDefault();
      event.stopPropagation();
      back();
      return;
    }
    if (event.target instanceof HTMLSelectElement) {
      if (event.key.startsWith('Arrow')) event.stopPropagation();
      return;
    }
    const providerRow = event.target instanceof HTMLElement && event.target.hasAttribute('data-provider-row');
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      const selector = providerRow || (!term && event.target === search.current && (!entered && narrow() || !narrow()))
        ? '[data-provider-row]' : '[data-model-row]';
      focusRow(selector, event.key === 'ArrowDown' ? 1 : -1, event.target);
    } else if (event.key === 'ArrowRight' && providerRow) {
      event.preventDefault();
      event.stopPropagation();
      setEntered(true);
      requestAnimationFrame(() => focusRow('[data-model-row]', 1));
    } else if ((event.key === 'ArrowLeft' && event.target instanceof HTMLButtonElement
        && event.target.hasAttribute('data-model-row') || event.key === 'Escape' && narrow() && entered) && !term) {
      event.preventDefault();
      event.stopPropagation();
      setEntered(false);
      requestAnimationFrame(() => root.current?.querySelector<HTMLButtonElement>('[data-provider-row][aria-current="true"]')?.focus());
    }
  }

  return (
    <div data-dsh-model-picker="" data-entered={String(entered)} ref={root} onKeyDown={keys}>
      <input ref={search} type="search" aria-label={t('search')} placeholder={t('search')}
        value={query} onChange={event => setQuery(event.target.value)} />
      {failed && <div className="picker-detail" role="status">{t('catalogFailed')}</div>}
      {state.failures.map(failure => <div key={failure.id} className="picker-detail" role="status">
        {failure.name} · {t('catalogFailed')}
      </div>)}
      {groups.length === 0 && <div role="status">{t(state.status === 'loading' ? 'loading' : 'empty')}</div>}
      {groups.length > 0 && <div className={term ? undefined : 'picker-columns'}>
        {!term && <div className="picker-providers" aria-label={t('providers')} role="group">
          {groups.map(item => {
            const highlighted = item.id === group?.id;
            const defaultRoute = activeRoute(item, accounts[item.id] ?? state.current?.provider);
            const title = item.id === 'qoder' && item.routes.length > 1
              ? `${item.name} · ${routeName(defaultRoute, t)}` : item.name;
            return <button key={item.id} type="button" data-provider-row="" aria-current={highlighted}
              aria-controls={id} onPointerEnter={event => {
                if (event.pointerType === 'mouse' && !narrow()) setProvider(item.id);
              }} onFocus={() => { if (!narrow()) setProvider(item.id); }}
              onClick={() => {
                setProvider(item.id);
                setEntered(true);
                requestAnimationFrame(() => focusRow('[data-model-row]', 1));
              }}>
              <span className="picker-title">{title}</span>
              <span aria-hidden="true">›</span>
            </button>;
          })}
        </div>}
        <div ref={results} id={id} className="picker-models" aria-label={t('models')} role="group">
          {!term && <>
            <button type="button" className="picker-back" onClick={() => {
              setEntered(false);
              requestAnimationFrame(() => root.current?.querySelector<HTMLButtonElement>('[data-provider-row][aria-current="true"]')?.focus());
            }}>‹ {t('back')}</button>
            {group && group.routes.length > 1 && <div className="picker-account">
              <label htmlFor={`${id}-account`}>{t('account')}</label>
              <select id={`${id}-account`} value={route?.id} onChange={event => {
                const value = event.target.value;
                setAccounts(previous => ({ ...previous, [group.id]: value }));
              }}>
                {group.routes.map(route => <option key={route.id} value={route.id}>{routeName(route, t)}</option>)}
              </select>
            </div>}
          </>}
          {models.map(item => <div key={item.route.id}>
            {term && <div className="picker-detail picker-section">{item.provider === item.route.name
              ? item.provider : `${item.provider} · ${routeName(item.route, t)}`}</div>}
            {item.models.map(model => {
              const selected = state.current?.provider === item.route.id && state.current.model === model.id;
              return <button key={model.id} type="button" data-model-row="" aria-current={selected} disabled={busy}
                onClick={() => choose(item.route, model)}>
                <span className="picker-title">{model.name}</span>{selected && <span aria-hidden="true">✓</span>}
              </button>;
            })}
          </div>)}
          {models.length === 0 && <div className="picker-detail" role="status">{t(term ? 'noMatches' : 'empty')}</div>}
        </div>
      </div>}
    </div>
  );
}
