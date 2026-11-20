import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-api-remotes/client';
import type { ModelPickerConnectionCard, PropsLocale, PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots';
import { useEffect, useState } from 'react';
import { groupProviders } from './model.js';
import { ConnectionCard } from './connection-card.js';
import { ManagementIcon } from './icons.js';

type Props = PropsLocale<'modelPicker'> & PropsRenderSlots<'modelPicker.connections'> & { ctx: Context };
type Groups = ReturnType<typeof groupProviders>;
type Snapshot = { groups: Groups; codex: boolean | null; catalogError: boolean; connectionError: boolean };
const empty: Snapshot = { groups: [], codex: null, catalogError: false, connectionError: false };

export function ModelManagement({ ctx, t, renderSlot }: Props) {
  const [snapshot, setSnapshot] = useState(empty);
  const [checking, setChecking] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [open, setOpen] = useState<string>();

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

  const countModels = (group: Groups[number]) =>
    new Set(group.routes.flatMap(route => route.models.map(model => model.id))).size;
  const modelLabel = (count: number) => t(count === 1 ? 'modelCountOne' : 'modelCount', { count });
  const codexModels = snapshot.groups.find(group => group.id === 'codex');
  const codexStatus = checking && snapshot.codex === null && !snapshot.connectionError ? 'checkingConnection'
    : snapshot.connectionError ? 'connectionFailed'
      : snapshot.codex === null ? 'connectionUnavailable'
        : snapshot.codex ? 'codexConnected' : 'codexDisconnected';
  const codexTone = codexStatus === 'checkingConnection' ? 'neutral' : snapshot.codex ? 'ready' : 'warning';

  function renderCard(card: ModelPickerConnectionCard) {
    return <ConnectionCard {...card} open={open === card.id} toggle={() => {
      setOpen(current => current === card.id ? undefined : card.id);
    }} />;
  }

  return <main className="dsh-model-management" aria-label={t('management')}>
    <div className="dsh-model-management-inner">
      <header className="dsh-model-management-header">
        <h1>{t('management')}</h1>
        <button type="button" onClick={() => setRefresh(value => value + 1)} disabled={checking}>
          <ManagementIcon name="refresh" />{t('refreshConnections')}
        </button>
      </header>
      <section className="dsh-model-management-section" aria-label={t('desktopConnections')}>
        <h2>{t('desktopConnections')}</h2>
        <div className="dsh-connection-grid">
          {renderCard({
            id: 'codex', name: 'Codex', status: t(codexStatus), tone: codexTone,
            description: snapshot.codex === true ? t('codexLocal') : undefined,
            footer: codexModels ? modelLabel(countModels(codexModels)) : undefined,
            action: t('viewConnection'),
            details: <section className="dsh-connection-text-details" aria-label={t('codexDetails')}>
              <h3>{t('codexDetails')}</h3>
              {codexStatus === 'connectionUnavailable' ? <p>{t('codexMissing')}</p>
                : snapshot.codex === false ? <p>{t('codexLoginStart')} <code>codex login</code> {t('codexLoginFinish')}</p>
                  : <p>{t(snapshot.codex === true && !snapshot.catalogError && !codexModels
                    ? 'codexEmptyCatalog' : codexStatus)}</p>}
              {codexModels && <p>{modelLabel(countModels(codexModels))}</p>}
            </section>,
          })}
          {renderSlot('modelPicker.connections', { renderCard, refresh })}
        </div>
      </section>
      <section className="dsh-model-management-section" aria-label={t('availableCatalog')}>
        <h2>{t('availableCatalog')}</h2>
        {snapshot.catalogError && <p role="alert">{t('catalogFailed')}</p>}
        {!snapshot.catalogError && !checking && snapshot.groups.length === 0 && <p>{t('empty')}</p>}
        {snapshot.groups.length > 0 && <div className="dsh-model-management-catalog">
          {snapshot.groups.map(group => <details key={group.id}>
            <summary>
              <ManagementIcon name="layers" />
              <span>{group.name}</span>
              <span>{modelLabel(countModels(group))}</span>
              <ManagementIcon name="chevron" />
            </summary>
            {group.routes.map(route => <div key={route.id} className="dsh-model-management-route">
              {group.routes.length > 1 && <h3>{route.name}</h3>}
              <ul>{route.models.map(model => <li key={model.id}>{model.name}</li>)}</ul>
            </div>)}
          </details>)}
        </div>}
      </section>
    </div>
  </main>;
}
