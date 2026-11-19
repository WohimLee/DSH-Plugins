import { useEffect, useState, useSyncExternalStore } from 'react';
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-api-gateway/client';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client';
import type {} from '@deepseek-ai/dsh-client-locale/client';
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client';
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import { contribution, emptySnapshot } from '../remote.js';
import type { AgentSyncRemote, Config, Snapshot } from '../remote.js';
import { messages } from './messages.js';

export const inject = ['slots', 'locale', 'remote'];
const panelStyle = `
.dsh-agent-sync-form :is(input:not([type='checkbox']), button) {
  font: inherit;
  color: inherit;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-primary, #8885);
  background: var(--dsw-alias-background-hover, #8882);
  min-height: 34px;
}
.dsh-agent-sync-form button { padding: 5px 12px; cursor: pointer; }
.dsh-agent-sync-form button[type='submit'] { background: var(--dsw-alias-background-active, #8884); }
.dsh-agent-sync-form button:disabled { opacity: .55; cursor: default; }
.dsh-agent-sync-form :is(input, button):focus-visible { outline: 2px solid var(--dsw-alias-accent-primary, #4c95f6); }
`;
const panelId = 'dsh-agent-sync' as MainPanelId;
type ErrorLabel = 'unavailable' | 'denied' | 'missingCodex' | 'codexFailed' | 'syncTimeout' | 'invalidDirectory'
  | 'tooManyRecords' | 'busy';
function errorLabel(code: string): ErrorLabel {
  switch (code) {
    case 'agent-sync/denied':
    case 'remote-access/denied': return 'denied';
    case 'agent-sync/missingCodex': return 'missingCodex';
    case 'agent-sync/codexFailed': return 'codexFailed';
    case 'agent-sync/syncTimeout': return 'syncTimeout';
    case 'agent-sync/invalidDirectory': return 'invalidDirectory';
    case 'agent-sync/tooManyRecords': return 'tooManyRecords';
    case 'agent-sync/busy': return 'busy';
    default: return 'unavailable';
  }
}

function createConnector(remote: AgentSyncRemote, signal: AbortSignal) {
  let snapshot = emptySnapshot;
  const listeners = new Set<() => void>();
  const update = (next: Snapshot) => {
    if (signal.aborted) return;
    snapshot = next;
    for (const listener of listeners) listener();
  };
  async function apply(run: () => Promise<RemoteResult<Snapshot>>): Promise<ErrorLabel | undefined> {
    try {
      const response = await run();
      if (!response.ok) return errorLabel(response.error.code);
      update(response.value);
    } catch { return 'unavailable'; }
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    status: () => apply(() => remote.status()),
    sync: (options: Config) => apply(() => remote.sync(options, signal)),
    disconnect: () => apply(() => remote.disconnect()),
    async open(id: string) {
      try {
        const response = await remote.open(id, signal);
        return response.ok && response.value;
      } catch { return false; }
    },
  };
}

type Connector = ReturnType<typeof createConnector>;
declare module '@deepseek-ai/cordis' {
  interface Context { agentSyncSessionsV1: Pick<Connector, 'getSnapshot' | 'subscribe' | 'open'> }
}

function Panel({ connector, t }: { connector: Connector } & PropsLocale<'agentSync'>) {
  const snapshot = useSyncExternalStore(connector.subscribe, connector.getSnapshot);
  const [config, setConfig] = useState(snapshot.config);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorLabel>();
  useEffect(() => setConfig(snapshot.config), [snapshot.config]);
  const synced = snapshot.syncedAt === null ? null : new Date(snapshot.syncedAt);
  const connected = synced !== null;
  const perform = async (action: () => Promise<ErrorLabel | undefined>) => {
    setBusy(true);
    setError(undefined);
    try { setError(await action()); }
    finally { setBusy(false); }
  };
  return <section aria-label={t('connectors')} style={{ width: '100%', height: '100%', overflow: 'auto', padding: 'clamp(16px, 4vw, 48px)' }}>
    <style>{panelStyle}</style>
    <div style={{ maxWidth: 620, marginInline: 'auto' }}>
      <h1 style={{ marginBottom: 20 }}>{t('connectors')}</h1>
      <form className="dsh-agent-sync-form" onSubmit={event => { event.preventDefault(); void perform(() => connector.sync({ ...config, cwd: config.cwd.trim() })); }}
        style={{ display: 'grid', gap: 16, border: '1px solid color-mix(in srgb, currentColor 18%, transparent)', borderRadius: 14, padding: 20 }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <h2 style={{ margin: 0 }}>Codex</h2>
          <span role="status">{t(busy ? 'syncing' : connected ? 'connected' : 'disconnected')}</span>
        </header>
        <label style={{ display: 'grid', gap: 6 }}>{t('directory')}
          <input value={config.cwd} disabled={busy} placeholder={t('directoryHint')}
            onChange={event => setConfig({ ...config, cwd: event.currentTarget.value })} style={{ padding: '7px 10px' }} />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={config.archived} disabled={busy}
            onChange={event => setConfig({ ...config, archived: event.currentTarget.checked })} />{t('archived')}
        </label>
        {synced && <div aria-live="polite">
          <p>{t('projects')} {snapshot.projects.length} · {t('sessions')} {snapshot.sessions.length}</p>
          <p>{t('syncedAt')} <time dateTime={synced.toISOString()}>{synced.toLocaleString()}</time></p>
          {!snapshot.projectsAvailable && <p>{t('fallback')}</p>}
        </div>}
        {error && <p role="alert" style={{ margin: 0 }}>{t(error)}</p>}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <button type="submit" disabled={busy}>{t(connected ? 'sync' : 'connect')}</button>
          {connected && <button type="button" disabled={busy} onClick={() => { void perform(connector.disconnect); }}>{t('disconnect')}</button>}
        </div>
      </form>
    </div>
  </section>;
}

function Icon() {
  return <span aria-hidden="true" style={{ fontSize: 19, lineHeight: 1 }}>⇄</span>;
}

export async function apply(ctx: Context): Promise<() => Promise<void>> {
  ctx.effect(() => ctx.locale.register('agentSync', messages));
  const unmount = await ctx.remote.$mount(contribution);
  const binding = ctx.inject(['remote.agentSync'], scope => {
    const lifetime = new AbortController();
    scope.effect(() => () => lifetime.abort());
    const connector = createConnector(scope.remote.agentSync, lifetime.signal);
    scope.provide('agentSyncSessionsV1', connector);
    void connector.status();
    scope.slots.inject('main', () => scope.slots.register({ name: 'main', key: panelId, locale: 'agentSync' },
      props => <Panel {...props} connector={connector} />));
    scope.slots.inject('sidebar.panellist', () => scope.slots.register({
      name: 'sidebar.panellist', id: panelId, locale: 'agentSync',
      label: () => scope.locale.bind('agentSync')('connectors'), order: 100,
    }, Icon));
  });
  return async () => { await binding.dispose(); await unmount(); };
}
