import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-api-remotes/client';
import type { ModelPickerConnectionCard, PropsLocale, PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CodexApi, CodexApiChange, CodexDesktop } from '../remote.js';
import { groupProviders } from './model.js';
import { ConnectionRow, ProviderIcon } from './connection-card.js';
import { ApiAccounts, CodexDesktopAccounts, DesktopDetection } from './connection-setup.js';
import { CardUsage } from './card-usage.js';
import { ManagementIcon, ProviderGlyph } from './icons.js';
import { createReadUsage } from './usage.js';

type Props = PropsLocale<'modelPicker'> & PropsRenderSlots<'modelPicker.connections'> & { ctx: Context; language: string };
type Translate = PropsLocale<'modelPicker'>['t'];
type Groups = ReturnType<typeof groupProviders>;
type Method = 'desktop' | 'api';
type Page = { kind: 'overview' } | { kind: 'provider'; id: string };
type Setup = { id: string; method: Method; initialCount: number | undefined; from: Page };
type Snapshot = {
  groups: Groups;
  failures: readonly { id: string; name: string; message: string }[];
  codex: boolean | null;
  codexDesktop: CodexDesktop | null;
  codexApi: CodexApi | null;
  deepseekSignedIn: boolean;
  deepseekApi: CodexApi | null;
  catalogError: boolean;
};
const empty: Snapshot = {
  groups: [], failures: [], codex: null, codexDesktop: null, codexApi: null,
  deepseekSignedIn: false, deepseekApi: null, catalogError: false,
};
const known = new Map([['codex', 'Codex'], ['qoder', 'Qoder'], ['grok', 'Grok'], ['deepseek', 'DeepSeek']]);
const methods = ['desktop', 'api'] as const;
const defaultPage: Page = { kind: 'overview' };

function modelLabel(t: Translate, count: number) {
  return t(count === 1 ? 'modelCountOne' : 'modelCount', { count });
}

function countModels(group: Groups[number]) {
  return new Set(group.routes.flatMap(route => route.models.map(model => model.id))).size;
}

function RegisterConnection({ card, report, remove }: {
  card: ModelPickerConnectionCard;
  report: (card: ModelPickerConnectionCard) => void;
  remove: (id: string) => void;
}) {
  useEffect(() => { report(card); }, [card, report]);
  useEffect(() => () => remove(card.id), [card.id, remove]);
  return null;
}

function MethodHeading({ method, t }: { method: Method; t: Translate }) {
  return <div className="dsh-method-heading">
    <span className="dsh-method-icon"><ManagementIcon name={method === 'desktop' ? 'desktop' : 'key'} /></span>
    <div><h2>{t(method)}</h2><p>{t(method === 'desktop' ? 'desktopDescription' : 'apiDescription')}</p></div>
  </div>;
}

export function ModelManagement({ ctx, t, renderSlot, language }: Props) {
  const [snapshot, setSnapshot] = useState(empty);
  const [checking, setChecking] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [page, setPage] = useState<Page>(defaultPage);
  const [setup, setSetup] = useState<Setup>();
  const [changing, setChanging] = useState(false);
  const [contributions, setContributions] = useState<ReadonlyMap<string, ModelPickerConnectionCard>>(new Map());
  const heading = useRef<HTMLHeadingElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef(false);
  const pendingCatalog = useRef<string>();
  const setupStarted = useRef(false);
  const readUsage = useMemo(() => createReadUsage(ctx), [ctx]);
  const refreshConnections = useCallback(() => setRefresh(value => value + 1), []);

  const report = useCallback((card: ModelPickerConnectionCard) => {
    setContributions(cards => cards.get(card.id) === card ? cards : new Map(cards).set(card.id, card));
  }, []);
  const remove = useCallback((id: string) => {
    setContributions(cards => {
      if (!cards.has(id)) return cards;
      const next = new Map(cards);
      next.delete(id);
      return next;
    });
  }, []);
  const slot = useMemo(() => renderSlot('modelPicker.connections', {
    renderCard: card => <RegisterConnection key={card.id} {...{ card, report, remove }} />,
    refresh,
  }), [renderSlot, refresh, report, remove]);

  useEffect(() => {
    let revision = 0;
    let mounted = true;
    let controller: AbortController | undefined;
    const read = async () => {
      const latest = ++revision;
      controller?.abort();
      controller = new AbortController();
      setChecking(true);
      const [catalog, connection, desktop, api, account, deepseek] = await Promise.allSettled([
        ctx.remote.session.modelCatalog(),
        ctx.remote.dshModelPickerUsage.codexConnection(),
        ctx.remote.dshModelPickerUsage.codexDesktop(controller.signal),
        ctx.remote.dshModelPickerUsage.codexApi(controller.signal),
        ctx.get('remote.account')?.getState(),
        ctx.remote.dshModelPickerUsage.deepSeekApi(controller.signal),
      ]);
      if (!mounted || latest !== revision) return;
      const value = catalog.status === 'fulfilled' && catalog.value.ok ? catalog.value.value : null;
      const response = connection.status === 'fulfilled' ? connection.value : null;
      const accountState = account.status === 'fulfilled' && account.value?.ok ? account.value.value : null;
      setSnapshot(previous => ({
        groups: value ? groupProviders(value.groups.filter(group => group.models.length > 0)) : previous.groups,
        failures: value?.failures ?? previous.failures,
        codex: response?.ok ? response.value : previous.codex,
        codexDesktop: desktop.status === 'fulfilled' && desktop.value.ok ? desktop.value.value : previous.codexDesktop,
        codexApi: api.status === 'fulfilled' && api.value.ok ? api.value.value : previous.codexApi,
        deepseekSignedIn: accountState ? accountState.status === 'credential-stored' : previous.deepseekSignedIn,
        deepseekApi: deepseek.status === 'fulfilled' && deepseek.value.ok ? deepseek.value.value : previous.deepseekApi,
        catalogError: value === null,
      }));
      setChecking(false);
    };
    const disposers = [
      ctx.remote.$on('llm/adapters-updated', () => { void read(); }),
      ctx.remote.$on('llm/models-updated', () => { void read(); }),
      ctx.on('connection/reset', () => { void read(); }),
    ];
    void read();
    return () => {
      mounted = false;
      controller?.abort();
      for (const dispose of disposers) dispose();
    };
  }, [ctx, refresh]);

  const cards = new Map<string, ModelPickerConnectionCard>(contributions);
  const codexModels = snapshot.groups.find(group => group.id === 'codex');
  const deepseekModels = snapshot.groups.find(group => group.id === 'deepseek');
  const signedInCodex = snapshot.codexDesktop?.accounts.filter(account => account.signedIn).length ?? Number(snapshot.codex === true);
  const boundCodexApi = snapshot.codexApi?.accounts.filter(account => account.connected).length ?? 0;
  const codexConnected = signedInCodex + boundCodexApi > 0 || !!codexModels;
  const deepseekDesktop = snapshot.deepseekSignedIn || !!deepseekModels?.routes.some(route => route.id === 'deepseek-account');
  const deepseekDefault = !!deepseekModels?.routes.some(route => route.id === 'deepseek-official');
  const boundDeepSeekApi = snapshot.deepseekApi?.accounts.filter(account => account.connected).length ?? 0;

  async function changeCodexApi(change: CodexApiChange, signal: AbortSignal) {
    const result = await ctx.remote.dshModelPickerUsage.changeCodexApi(change, signal);
    return result.ok ? result.value : 'unavailable';
  }
  async function changeDeepSeekApi(change: CodexApiChange, signal: AbortSignal) {
    const result = await ctx.remote.dshModelPickerUsage.changeDeepSeekApi(change, signal);
    return result.ok ? result.value : 'unavailable';
  }

  cards.set('codex', {
    id: 'codex', name: 'Codex', action: t('viewConnection'),
    status: t(codexConnected ? 'connected' : 'codexDisconnected'),
    tone: codexConnected ? 'ready' : 'warning',
    description: signedInCodex ? t('codexLocal') : undefined,
    footer: codexModels ? modelLabel(t, countModels(codexModels)) : undefined,
    details: null,
    connection: {
      connected: codexConnected,
      accountCount: signedInCodex + boundCodexApi,
      desktop: <CodexDesktopAccounts {...{ ctx, t, checking }} refresh={refreshConnections}
        state={snapshot.codexDesktop} legacy={snapshot.codex} />,
      api: <ApiAccounts {...{ t }} state={snapshot.codexApi} change={changeCodexApi} refresh={refreshConnections}
        keyLabel={t('openaiApiKey')} />,
      setup: {
        desktop: snapshot.codexDesktop?.canManage ? <CodexDesktopAccounts {...{ ctx, t, checking }} refresh={refreshConnections}
          state={snapshot.codexDesktop} legacy={snapshot.codex} configure onBusy={setChanging} /> : undefined,
        api: snapshot.codexApi?.canManage ? <ApiAccounts {...{ t }} state={snapshot.codexApi} change={changeCodexApi}
          refresh={refreshConnections} keyLabel={t('openaiApiKey')} configure onBusy={setChanging} /> : undefined,
      },
    },
  });
  cards.set('deepseek', {
    id: 'deepseek', name: 'DeepSeek', action: t('viewConnection'), status: t('providerAvailable'), tone: 'ready',
    footer: deepseekModels ? modelLabel(t, countModels(deepseekModels)) : undefined,
    details: null,
    connection: {
      connected: deepseekDesktop || deepseekDefault || boundDeepSeekApi > 0,
      accountCount: Number(deepseekDesktop) + Number(deepseekDefault) + boundDeepSeekApi,
      desktop: <div className="dsh-connection-method-content">
        <DesktopDetection installed={null} signedIn={deepseekDesktop} t={t} />
        {deepseekDesktop && <strong>{t('deepseekAccount')}</strong>}
        <p>{t(deepseekDesktop ? 'deepseekNativeAccount' : 'deepseekNativeSignIn')}</p>
      </div>,
      api: <>
        {deepseekDefault && <div className="dsh-connection-method-content">
          <strong>{t('deepseekDefaultKey')}</strong><p>{t('deepseekExistingKey')}</p>
        </div>}
        {snapshot.deepseekApi && (snapshot.deepseekApi.accounts.length > 0 || !deepseekDefault) && <ApiAccounts {...{ t }}
          state={snapshot.deepseekApi} change={changeDeepSeekApi} refresh={refreshConnections} keyLabel={t('apiKey')} />}
      </>,
      setup: { api: snapshot.deepseekApi?.canManage ? <ApiAccounts {...{ t }} state={snapshot.deepseekApi}
        change={changeDeepSeekApi} refresh={refreshConnections} keyLabel={t('apiKey')} configure onBusy={setChanging} /> : undefined },
    },
  });

  for (const group of snapshot.groups) {
    if (cards.has(group.id)) continue;
    cards.set(group.id, {
      id: group.id, name: group.name, action: t('viewConnection'), status: t('providerAvailable'), tone: 'ready',
      footer: modelLabel(t, countModels(group)),
      details: null,
      connection: { connected: true, accountCount: group.routes.length },
    });
  }
  const providers = new Map(known);
  for (const card of cards.values()) providers.set(card.id, card.name);
  const connected = [...providers.keys()].filter(id => {
    const card = cards.get(id);
    return card && (card.connection?.connected ?? card.tone === 'ready');
  });
  const key = setup ? 'add' : page.kind === 'overview' ? 'overview' : page.id;
  const currentConnected = page.kind !== 'provider' || connected.includes(page.id);
  const visibleCard = page.kind === 'provider' ? cards.get(page.id) : undefined;
  const visibleGroup = visibleCard && snapshot.groups.find(group => group.id === visibleCard.id);
  const adding = setup ? cards.get(setup.id) : undefined;
  const setupBusy = !!setup && (changing || adding?.connection?.busy === true);
  const addedCount = adding?.connection?.accountCount ?? (adding?.tone === 'ready' ? 1 : undefined);
  const setupId = setup?.id;
  const setupMethod = setup?.method;

  function navigate(next: Page) {
    pendingFocus.current = true;
    setPage(next);
    setSetup(undefined);
  }

  function openSetup(id?: string, method: Method = 'desktop') {
    const provider = id ?? [...providers.keys()].find(item => !connected.includes(item) && cards.has(item))
      ?? [...providers.keys()].find(item => !connected.includes(item)) ?? 'codex';
    const card = cards.get(provider);
    pendingFocus.current = true;
    setupStarted.current = false;
    setSetup({ id: provider, method, initialCount: card?.connection?.accountCount ?? (connected.includes(provider) ? 1 : 0), from: page });
  }

  useEffect(() => {
    if (setupId && setupMethod === 'desktop') refreshConnections();
  }, [setupId, setupMethod, refreshConnections]);

  useEffect(() => {
    if (setup && setupStarted.current && addedCount !== undefined && addedCount > (setup.initialCount ?? 0)) {
      pendingFocus.current = true;
      setPage({ kind: 'provider', id: setup.id });
      setSetup(undefined);
    }
  }, [setup, addedCount]);

  useEffect(() => {
    if (!setup && !checking && !currentConnected) {
      pendingFocus.current = true;
      setPage(defaultPage);
    }
  }, [checking, currentConnected, setup]);

  useEffect(() => {
    if (!pendingFocus.current) return;
    pendingFocus.current = false;
    if (body.current) body.current.scrollTop = 0;
    const id = pendingCatalog.current;
    pendingCatalog.current = undefined;
    if (id && body.current) {
      const catalog = body.current.querySelector<HTMLDetailsElement>(`[data-model-catalog="${CSS.escape(id)}"]`);
      const summary = catalog?.querySelector('summary');
      if (catalog && summary) {
        catalog.open = true;
        summary.focus();
        return;
      }
    }
    heading.current?.focus();
  }, [key]);

  function methodContent(card: ModelPickerConnectionCard | undefined, method: Method, configuring = false): ReactNode {
    if (!card) return <p>{t('connectionPluginRequired')}</p>;
    return (configuring ? card.connection?.setup?.[method] : undefined) ?? card.connection?.[method]
      ?? (method === 'api' && !card.connection && card.id === 'grok' ? card.details : null)
      ?? <p>{t('unsupportedMethod')}</p>;
  }

  return <main className="dsh-model-management" aria-label={t('management')}>
    <nav className="dsh-model-management-nav" aria-label={t('management')}>
      <h2>{t('models')}</h2>
      <button type="button" disabled={setupBusy} aria-current={key === 'overview' ? 'page' : undefined}
        onClick={() => navigate(defaultPage)}>
        <ManagementIcon name="overview" />{t('overview')}
      </button>
      <button type="button" disabled={setupBusy} aria-current={key === 'add' ? 'page' : undefined}
        onClick={() => { if (!setup) openSetup(); }}>
        <ManagementIcon name="add" />{t('addProvider')}
      </button>
      {connected.length > 0 && <p>{t('providers')}</p>}
      {connected.map(id => <button type="button" key={id} disabled={setupBusy} aria-current={key === id ? 'page' : undefined}
        onClick={() => navigate({ kind: 'provider', id })}>
        <ProviderGlyph id={id} />{providers.get(id)}
      </button>)}
    </nav>
    <div className="dsh-model-management-body" ref={body}>
      <div className="dsh-model-management-inner">
        {setup ? <>
          <header className="dsh-model-management-header"><h1 ref={heading} tabIndex={-1}>{t('addProvider')}</h1></header>
          <section className="dsh-connection-setup">
            <div className="dsh-connection-setup-fields">
              <label>{t('provider')}<select disabled={setupBusy} aria-label={t('provider')} value={setup.id} onChange={event => {
                const id = event.currentTarget.value;
                const card = cards.get(id);
                setupStarted.current = false;
                setSetup({ ...setup, id, initialCount: card?.connection?.accountCount ?? (connected.includes(id) ? 1 : 0) });
              }}>
                {[...providers].map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select></label>
              <label>{t('connectionMethod')}<select disabled={setupBusy} aria-label={t('connectionMethod')} value={setup.method} onChange={event => {
                const method = event.currentTarget.value === 'api' ? 'api' : 'desktop';
                setupStarted.current = false;
                setSetup({ ...setup, method });
              }}>{methods.map(method => <option key={method} value={method}>{t(method)}</option>)}</select></label>
            </div>
            <div className="dsh-connection-setup-method" key={setup.id + ':' + setup.method}
              onSubmitCapture={() => { setupStarted.current = true; }}
              onClickCapture={event => {
                if (event.target instanceof Element && event.target.closest('[data-provider-login]')) setupStarted.current = true;
              }}>
              <h2>{t(setup.method === 'desktop' ? 'desktopDetection' : 'apiConfiguration')}</h2>
              {methodContent(adding, setup.method, true)}
              {!adding?.connection && adding?.details && !(setup.method === 'api' && adding.id === 'grok') && adding.details}
            </div>
            <footer>
              <button type="button" disabled={setupBusy} onClick={() => navigate(setup.from)}>{t('cancel')}</button>
            </footer>
          </section>
        </> : page.kind === 'provider' && visibleCard ? <>
          <header className="dsh-model-management-header dsh-provider-header">
            <div><ProviderIcon id={page.id} /><div>
              <h1 tabIndex={-1} ref={heading}>{visibleCard.name}</h1>
              <p>{t('connectionAccounts')}{visibleCard.footer && <> · {visibleCard.footer}</>}</p>
            </div></div>
            <button type="button" disabled={checking} onClick={refreshConnections}>
              <ManagementIcon name="refresh" />{t('refreshConnections')}
            </button>
          </header>
          <div className="dsh-connection-method-stack" key={visibleCard.id}>
            <section className="dsh-connection-usage-summary" aria-label={t('usage')}>
              <h2>{t('usage')}</h2>
              <CardUsage group={visibleGroup} name={visibleCard.name} {...{ readUsage, refresh, t, language }}
                includeDeepSeekAccount={visibleCard.id === 'deepseek' && snapshot.deepseekSignedIn}
                unavailable={visibleCard.id === 'grok' ? t('usageInXaiConsole') : t('unavailable')} />
            </section>
            {visibleGroup && <button type="button" className="dsh-model-catalog-jump" onClick={() => {
              pendingCatalog.current = visibleGroup.id;
              navigate(defaultPage);
            }}><ManagementIcon name="layers" />{t('viewAvailableModels')}</button>}
            {methods.map(method => <section className="dsh-connection-method" key={method} aria-label={t(method)}>
              <header><MethodHeading method={method} t={t} />
                {visibleCard.connection?.setup?.[method] && <button type="button" data-emphasis="true"
                  aria-label={t(method === 'desktop' ? 'addDesktopAccount' : 'addApiAccount')}
                  onClick={() => openSetup(visibleCard.id, method)}><ManagementIcon name="add" size={14} />{t('addAccount')}</button>}
              </header>
              {methodContent(visibleCard, method)}
            </section>)}
            {!visibleCard.connection && visibleCard.id !== 'grok' && visibleCard.details}
          </div>
        </> : <>
          <header className="dsh-model-management-header">
            <h1 ref={heading} tabIndex={-1}>{t('management')}</h1>
            <button type="button" onClick={refreshConnections} disabled={checking}>
              <ManagementIcon name="refresh" />{t('refreshConnections')}
            </button>
          </header>
          <section className="dsh-model-management-section" aria-label={t('desktopConnections')}>
            <h2>{t('desktopConnections')}</h2>
            {connected.length === 0 && <p role="status">{t(checking ? 'checkingConnection' : 'noConnections')}</p>}
            {connected.length > 0 && <div className="dsh-connection-list">
              {connected.map(id => <ConnectionRow key={id} {...cards.get(id)!} open={() => navigate({ kind: 'provider', id })} />)}
            </div>}
          </section>
          <section className="dsh-model-management-section" aria-label={t('availableCatalog')}>
            <h2>{t('availableCatalog')}</h2>
            {snapshot.catalogError && <p role="alert">{t('catalogFailed')}</p>}
            {snapshot.failures.map(failure => <p role="status" key={failure.id}>{failure.name} · {failure.message}</p>)}
            {!snapshot.catalogError && !checking && snapshot.groups.length === 0 && snapshot.failures.length === 0 && <p>{t('empty')}</p>}
            {snapshot.groups.length > 0 && <div className="dsh-model-management-catalog">
              {snapshot.groups.map(group => <details key={group.id} data-model-catalog={group.id}>
                <summary><ManagementIcon name="layers" /><span>{group.name}</span>
                  <span>{modelLabel(t, countModels(group))}</span><ManagementIcon name="chevron" />
                </summary>
                {group.routes.map(route => <div key={route.id} className="dsh-model-management-route">
                  {group.routes.length > 1 && <h3>{route.name}</h3>}
                  <ul>{route.models.map(model => <li key={model.id}>
                    <strong>{model.name}</strong>
                    {model.description && <p>{model.description}</p>}
                    {model.reasoning && <p>{t('effortLevels', { levels: model.reasoning.efforts.map(e => e.name).join(' / ') })}</p>}
                  </li>)}</ul>
                </div>)}
              </details>)}
            </div>}
          </section>
        </>}
      </div>
      <div className="dsh-model-legacy-connections" hidden={!setup || !!adding}>{slot}</div>
    </div>
  </main>;
}
