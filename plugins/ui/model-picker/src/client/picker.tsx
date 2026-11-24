import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import type { Context } from '@deepseek-ai/cordis';
import type { ModelDirectory, ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client';
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import { activeRoute, groupProviders, routeName, routeSource } from './model.js';

type Route = ModelDirectoryState['groups'][number];
type Model = Route['models'][number];
type Props = Pick<PropsRuntime<'conversation.input.model.options'>, 'locked' | 'dismiss' | 'reportFailure'> & PropsLocale<'modelPicker'> & {
  directory: ModelDirectory;
  ctx: Context;
  back: () => void;
};

const narrow = () => window.matchMedia('(max-width: 389px), (pointer: coarse)').matches;

export function Picker({ directory, ctx, locked, dismiss, reportFailure, back, t }: Props) {
  const state = useSyncExternalStore(directory.store.subscribe, directory.store.getSnapshot);
  const groups = useMemo(() => groupProviders(state.groups), [state.groups]);
  const [provider, setProvider] = useState('');
  const [accounts, setAccounts] = useState<Record<string, string>>({});
  const [qoderSources, setQoderSources] = useState<ReadonlyMap<string, 'desktop' | 'api'>>(new Map());
  const [query, setQuery] = useState('');
  const [failed, setFailed] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const results = useRef<HTMLDivElement>(null);
  const providers = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>();
  const id = useId();
  const group = groups.find(item => item.id === provider);
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

  useEffect(() => {
    const face = ctx.get('remote.dshQoderAccounts') as {
      list(refresh: boolean): Promise<{ ok: false } | { ok: true; value: { provider: string; browserLogin?: boolean }[] }>;
    } | undefined;
    let active = true;
    if (face && groups.some(item => item.id === 'qoder')) {
      void face.list(false).then(result => {
        if (active && result.ok) setQoderSources(new Map(result.value.flatMap(account =>
          account.browserLogin === undefined ? [] : [[account.provider, account.browserLogin ? 'desktop' : 'api']])));
      }).catch(() => {});
    }
    return () => { active = false; };
  }, [ctx, groups]);

  useEffect(() => () => clearTimeout(closeTimer.current), []);

  function sourceLabel(route: Route): string | undefined {
    const source = qoderSources.get(route.id) ?? routeSource(route.id);
    return source && t(source);
  }

  function accountLabel(route: Route): string {
    const source = sourceLabel(route);
    return source ? `${routeName(route, t)} · ${source}` : routeName(route, t);
  }

  function leaveBranch(event: PointerEvent): void {
    if (event.pointerType !== 'mouse') return;
    const target = event.relatedTarget;
    if (target instanceof Node && (results.current?.contains(target) || providers.current?.contains(target))) return;
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => {
      if (!results.current?.contains(document.activeElement)) setProvider('');
    }, 180);
  }

  function enterProvider(id: string, focus = false): void {
    clearTimeout(closeTimer.current);
    setProvider(id);
    if (focus) requestAnimationFrame(() => focusRow('[data-model-row]', 1));
  }

  function returnToProviders(): void {
    clearTimeout(closeTimer.current);
    const row = [...(providers.current?.querySelectorAll<HTMLButtonElement>('[data-provider-row]') ?? [])]
      .find(node => node.dataset.providerRow === provider);
    setProvider('');
    requestAnimationFrame(() => row?.focus());
  }

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
    const target = event.target;
    const providerId = target instanceof HTMLElement ? target.dataset.providerRow : undefined;
    const atModels = target instanceof Node && results.current?.contains(target);
    if (target instanceof HTMLSelectElement && event.key.startsWith('Arrow')) {
      event.stopPropagation();
      return;
    }
    if (event.key === 'Escape' || event.key === 'ArrowLeft' && atModels && !searching) {
      event.preventDefault();
      event.stopPropagation();
      if (group && atModels && !searching) returnToProviders();
      else back();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      const selector = atModels || searching ? '[data-model-row]' : '[data-provider-row]';
      focusRow(selector, event.key === 'ArrowDown' ? 1 : -1, target);
    } else if (event.key === 'ArrowRight' && providerId) {
      event.preventDefault();
      event.stopPropagation();
      enterProvider(providerId, true);
    }
  }

  return <div data-dsh-model-picker="" data-entered={String(!!group && !searching)} ref={root} onKeyDown={keys}>
    <div className="picker-primary picker-surface">
      <input ref={search} type="search" aria-label={t('search')} placeholder={t('search')}
        value={query} onChange={event => { setProvider(''); setQuery(event.target.value); }} />
      {failed && <div className="picker-detail" role="status">{t('catalogFailed')}</div>}
      {state.failures.map(failure => <div key={failure.id} className="picker-detail" role="status">
        {failure.name} · {t('catalogFailed')}
      </div>)}
      {groups.length === 0 && <div role="status">{t(state.status === 'loading' ? 'loading' : 'empty')}</div>}
      {!searching && <div ref={providers} className="picker-providers" aria-label={t('providers')} role="group"
        onPointerLeave={leaveBranch}>
        {groups.map(item => <button key={item.id} type="button" data-provider-row={item.id} aria-expanded={item.id === provider}
          aria-controls={item.id === provider ? id : undefined} onPointerEnter={event => {
            if (event.pointerType === 'mouse' && !narrow()) enterProvider(item.id);
          }} onClick={() => enterProvider(item.id, true)}>
          <span className="picker-title" title={item.name}>{item.name}</span>
          <span aria-hidden="true">›</span>
        </button>)}
      </div>}
      {searching && <div ref={results} className="picker-search-results" aria-label={t('models')} role="group">
        {renderModels()}
      </div>}
    </div>
    {group && route && !searching && <div ref={results} id={id} className="picker-models picker-surface"
      aria-label={t('models')} role="group" onPointerEnter={() => clearTimeout(closeTimer.current)} onPointerLeave={leaveBranch}>
      <button type="button" className="picker-back" onClick={returnToProviders}>‹ {t('back')}</button>
      {group.routes.length > 1
        ? <div className="picker-account"><label htmlFor={`${id}-account`}>{t('account')}</label>
          <select id={`${id}-account`} value={route.id} onChange={event => {
            const value = event.target.value;
            setAccounts(previous => ({ ...previous, [group.id]: value }));
          }}>
            {group.routes.map(item => <option key={item.id} value={item.id}>{accountLabel(item)}</option>)}
          </select>
        </div>
        : sourceLabel(route) && <p className="picker-detail picker-section">{sourceLabel(route)}</p>}
      {renderModels()}
    </div>}
  </div>;

  function renderModels() {
    if (models.length === 0) return <div className="picker-detail" role="status">{t(searching ? 'noMatches' : 'empty')}</div>;
    return models.map(item => <div key={item.route.id}>
      {searching && <div className="picker-detail picker-section">
        {item.provider === item.route.name
          ? [item.provider, sourceLabel(item.route)].filter(Boolean).join(' · ')
          : `${item.provider} · ${accountLabel(item.route)}`}
      </div>}
      {item.models.map(model => {
        const selected = state.current?.provider === item.route.id && state.current.model === model.id;
        return <button key={model.id} type="button" data-model-row="" aria-current={selected} disabled={busy}
          onClick={() => choose(item.route, model)}>
          <span className="picker-title" title={model.name}>{model.name}</span>{selected && <span aria-hidden="true">✓</span>}
        </button>;
      })}
    </div>);
  }
}
