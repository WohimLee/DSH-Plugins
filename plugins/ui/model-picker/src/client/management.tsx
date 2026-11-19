import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-api-remotes/client';
import type { PropsLocale, PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots';
import { useEffect, useState } from 'react';
import { groupProviders } from './model.js';

type Props = PropsLocale<'modelPicker'> & PropsRenderSlots<'modelPicker.connections'> & { ctx: Context };
type Groups = ReturnType<typeof groupProviders>;
type Snapshot = { groups: Groups; codex: boolean | null; catalogError: boolean; connectionError: boolean };
const empty: Snapshot = { groups: [], codex: null, catalogError: false, connectionError: false };

export function ModelManagement({ ctx, t, renderSlot }: Props) {
  const [snapshot, setSnapshot] = useState(empty);
  const [checking, setChecking] = useState(true);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let revision = 0;
    let mounted = true;
    const read = async () => {
      const latest = ++revision;
      setChecking(true);
      const [catalog, connection] = await Promise.allSettled([
        ctx.remote.session.modelCatalog(),
        ctx.remote.dshModelPickerUsage.codexConnection(),
      ]);
      if (!mounted || latest !== revision) return;
      const value = catalog.status === 'fulfilled' && catalog.value.ok ? catalog.value.value : null;
      const response = connection.status === 'fulfilled' ? connection.value : null;
      setSnapshot({
        groups: value ? groupProviders(value.groups.filter(group => group.models.length > 0)) : [],
        codex: response?.ok ? response.value : null,
        catalogError: value === null,
        connectionError: !response?.ok,
      });
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
      for (const dispose of disposers) dispose();
    };
  }, [ctx, refresh]);

  const codexModels = snapshot.groups.find(group => group.id === 'codex');
  return <main className="dsh-model-management" aria-label={t('management')}>
    <header className="dsh-model-management-header">
      <h1>{t('management')}</h1>
      <button type="button" onClick={() => setRefresh(value => value + 1)} disabled={checking}>{t('refreshConnections')}</button>
    </header>
    <section className="dsh-model-management-card" aria-label="Codex">
      <h2>Codex</h2>
      {checking ? <p role="status">{t('checkingConnection')}</p> : snapshot.connectionError
        ? <p role="alert">{t('connectionFailed')}</p> : snapshot.codex === null
          ? <p>{t('codexMissing')}</p> : <>
            <p>{t(snapshot.codex ? 'codexConnected' : 'codexDisconnected')}</p>
            {snapshot.codex ? !snapshot.catalogError && !codexModels && <p>{t('codexEmptyCatalog')}</p>
              : <p>{t('codexLoginStart')} <code>codex login</code> {t('codexLoginFinish')}</p>}
          </>}
    </section>
    {renderSlot('modelPicker.connections', {})}
    <section className="dsh-model-management-card" aria-label={t('availableCatalog')}>
      <h2>{t('availableCatalog')}</h2>
      {snapshot.catalogError && <p role="alert">{t('catalogFailed')}</p>}
      {!snapshot.catalogError && !checking && snapshot.groups.length === 0 && <p>{t('empty')}</p>}
      {snapshot.groups.map(group => <details key={group.id}>
        <summary>{group.name} <span>{t('modelCount', { count: new Set(group.routes.flatMap(route => route.models.map(model => model.id))).size })}</span></summary>
        {group.routes.map(route => <div key={route.id} className="dsh-model-management-route">
          {group.routes.length > 1 && <h3>{route.name}</h3>}
          <ul>{route.models.map(model => <li key={model.id}>{model.name}</li>)}</ul>
        </div>)}
      </details>)}
    </section>
  </main>;
}
