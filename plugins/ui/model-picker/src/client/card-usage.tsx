import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';
import { useEffect, useId, useState } from 'react';
import { routeName, type ProviderGroup } from './model.js';
import { usageDetails, usagePercent, type ReadUsage, type Usage } from './usage.js';

type UsageProps = PropsLocale<'modelPicker'> & {
  language: string; readUsage: ReadUsage; refresh: number; name: string; unavailable: string;
};

export function CardUsage({ group, includeDeepSeekAccount, ...props }:
UsageProps & { group?: ProviderGroup; includeDeepSeekAccount: boolean }) {
  const [preferred, setPreferred] = useState<string>();
  const accounts = group?.routes.map(route => ({ id: route.id, name: routeName(route, props.t) })) ?? [];
  if (includeDeepSeekAccount && !accounts.some(account => account.id === 'deepseek-account')) {
    accounts.unshift({ id: 'deepseek-account', name: props.t('deepseekAccount') });
  }
  const account = accounts.find(account => account.id === preferred)
    ?? accounts.find(account => account.id === 'deepseek-account') ?? accounts[0];

  return <div className="dsh-connection-usage-controls">
    {accounts.length > 1 && <select aria-label={props.t('accountFor', { name: props.name })}
      value={account.id} onChange={event => setPreferred(event.currentTarget.value)}>
      {accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
    </select>}
    <UsageRing key={account?.id} provider={account?.id} {...props} />
  </div>;
}

function UsageRing({ provider, name, readUsage, refresh, t, language, unavailable }: UsageProps & { provider?: string }) {
  const id = useId();
  const [usage, setUsage] = useState<Usage | null>();

  useEffect(() => {
    if (!provider) return;
    const controller = new AbortController();
    void readUsage(provider, controller.signal).catch(() => null).then(value => {
      if (!controller.signal.aborted) setUsage(value);
    });
    return () => controller.abort();
  }, [provider, readUsage, refresh]);

  const percent = usage ? usagePercent(usage) : undefined;
  const details = usage ? usageDetails(usage, t, language) : [];
  const lines = details.length ? details : [provider && usage === undefined ? t('loading') : unavailable];

  const summary = usage ? usageDetails(usage, t, language, false)[0] ?? unavailable : lines[0];

  return <div className="dsh-connection-usage">
    <button type="button" className="dsh-connection-usage-button" aria-label={t('usageFor', { name })}
      aria-describedby={id} data-remaining={percent}>
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <circle className="dsh-connection-usage-track" cx="10" cy="10" r="8" />
        {percent !== undefined && percent > 0 && <circle className="dsh-connection-usage-arc"
          cx="10" cy="10" r="8" pathLength="100" strokeDasharray={`${percent} 100`} />}
      </svg>
      <span>{summary}</span>
    </button>
    <div id={id} className="dsh-connection-usage-tooltip" role="tooltip">
      {lines.map((line, index) => <span key={index}>{line}</span>)}
    </div>
  </div>;
}
