import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-api-remotes/client';
import type { ModelPickerConnectionCard, PropsLocale, PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots';
import { useEffect, useMemo, useState } from 'react';
import { groupProviders } from './model.js';
import { ConnectionCard } from './connection-card.js';
import { CardUsage } from './card-usage.js';
import { ManagementIcon } from './icons.js';
import { createReadUsage } from './usage.js';

type Props = PropsLocale<'modelPicker'> & PropsRenderSlots<'modelPicker.connections'> & { ctx: Context; language: string };
type Groups = ReturnType<typeof groupProviders>;
type Snapshot = {
  groups: Groups;
  failures: readonly { id: string; name: string; message: string }[];
  codex: boolean | null;
  deepseekSignedIn: boolean;
  catalogError: boolean;
  connectionError: boolean;
};
const empty: Snapshot = {
  groups: [], failures: [], codex: null, deepseekSignedIn: false, catalogError: false, connectionError: false,
};

export function ModelManagement({ ctx, t, renderSlot, language }: Props) {
  const [snapshot, setSnapshot] = useState(empty);
  const [checking, setChecking] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const readUsage = useMemo(() => createReadUsage(ctx), [ctx]);

  useEffect(() => {
    let revision = 0;
    let mounted = true;
    const read = async () => {
      const latest = ++revision;
      setChecking(true);
      const [catalog, connection, account] = await Promise.allSettled([
        ctx.remote.session.modelCatalog(),
        ctx.remote.dshModelPickerUsage.codexConnection(),
        ctx.get('remote.account')?.getState(),
      ]);
      if (!mounted || latest !== revision) return;
      const value = catalog.status === 'fulfilled' && catalog.value.ok ? catalog.value.value : null;
      const response = connection.status === 'fulfilled' ? connection.value : null;
      setSnapshot({
        groups: value ? groupProviders(value.groups.filter(group => group.models.length > 0)) : [],
        failures: value?.failures ?? [],
        codex: response?.ok ? response.value : null,
        deepseekSignedIn: account.status === 'fulfilled' && account.value?.ok === true
          && account.value.value?.status === 'credential-stored',
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
  const deepseekModels = snapshot.groups.find(group => group.id === 'deepseek');
  const codexStatus = checking && snapshot.codex === null && !snapshot.connectionError ? 'checkingConnection'
    : snapshot.connectionError ? 'connectionFailed'
      : snapshot.codex === null ? 'connectionUnavailable'
        : snapshot.codex ? 'codexConnected' : 'codexDisconnected';
  const codexTone = codexStatus === 'checkingConnection' ? 'neutral' : snapshot.codex ? 'ready' : 'warning';

  function renderCard(card: ModelPickerConnectionCard) {
    const group = snapshot.groups.find(group => group.id === card.id);
    return <ConnectionCard {...card} closeLabel={t('closeDetails')}
      usage={<CardUsage group={group} name={card.name} {...{ readUsage, refresh, t, language }}
        includeDeepSeekAccount={card.id === 'deepseek' && snapshot.deepseekSignedIn}
        unavailable={card.id === 'grok' ? t('usageInXaiConsole') : t('unavailable')} />} />;
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
          {(deepseekModels || snapshot.deepseekSignedIn) && renderCard({
            id: 'deepseek', name: 'DeepSeek', status: t('providerAvailable'), tone: 'ready',
            footer: deepseekModels ? modelLabel(countModels(deepseekModels)) : undefined, action: t('viewConnection'),
            details: <section className="dsh-connection-text-details" aria-label={t('deepseekDetails')}>
              <h3>{t('deepseekDetails')}</h3>
              {deepseekModels?.routes.map(route => <p key={route.id}>
                {route.id === 'deepseek-account' ? t('deepseekAccount') : t('deepseekKey')} · {modelLabel(route.models.length)}
              </p>)}
              {!deepseekModels && <p>{t('empty')}</p>}
            </section>,
          })}
        </div>
      </section>
      <section className="dsh-model-management-section" aria-label={t('availableCatalog')}>
        <h2>{t('availableCatalog')}</h2>
        {snapshot.catalogError && <p role="alert">{t('catalogFailed')}</p>}
        {snapshot.failures.map(failure => <p role="status" key={failure.id}>{failure.name} · {failure.message}</p>)}
        {!snapshot.catalogError && !checking && snapshot.groups.length === 0 && snapshot.failures.length === 0 && <p>{t('empty')}</p>}
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
              <ul>{route.models.map(model => <li key={model.id}>
                <strong>{model.name}</strong>
                {model.description && <p>{model.description}</p>}
                {model.reasoning && <p>{t('effortLevels', { levels: model.reasoning.efforts.map(e => e.name).join(' · ') })}</p>}
              </li>)}</ul>
            </div>)}
          </details>)}
        </div>}
      </section>
    </div>
  </main>;
}
