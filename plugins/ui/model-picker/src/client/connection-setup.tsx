import type { Context } from '@deepseek-ai/cordis';
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';
import { useEffect, useRef, useState } from 'react';
import type { CodexAccountChange, CodexApi, CodexApiChange, CodexApiResult, CodexDesktop } from '../remote.js';
import { ManagementIcon } from './icons.js';

type Translate = PropsLocale<'modelPicker'>['t'];

export function DesktopDetection({ installed, signedIn, t }: {
  installed: boolean | null;
  signedIn: boolean | null;
  t: Translate;
}) {
  const rows = [
    { label: t('desktopApp'), result: installed, yes: t('installed'), no: t('notDetected') },
    { label: t('signIn'), result: signedIn, yes: t('signedIn'), no: t('signedOut') },
  ];
  return <dl className="dsh-desktop-detection" aria-label={t('desktopDetection')}>
    {rows.map(({ label, result, yes, no }) => <div key={label}>
      <dt>{label}</dt>
      <dd className="dsh-connection-status" data-tone={result === null ? 'neutral' : result ? 'ready' : 'warning'}>
        <ManagementIcon name={result ? 'check' : 'alert'} size={14} />
        {result === null ? t('unavailableCheck') : result ? yes : no}
      </dd>
    </div>)}
  </dl>;
}

export function CodexDesktopAccounts({ ctx, t, state, legacy, checking, refresh, configure = false, onBusy }: {
  ctx: Context;
  t: Translate;
  state: CodexDesktop | null;
  legacy: boolean | null;
  checking: boolean;
  refresh: () => void;
  configure?: boolean;
  onBusy?: (pending: boolean) => void;
}) {
  const [home, setHome] = useState('');
  const [label, setLabel] = useState('');
  const [adding, setAdding] = useState(configure);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<'invalidHome' | 'unsignedProfile' | 'duplicateAccount' | 'connectionChangeFailed'>();
  const operation = useRef<AbortController>();
  useEffect(() => () => operation.current?.abort(), []);
  const signedIn = state ? state.accounts.some(account => account.signedIn) : legacy;

  async function change(input: CodexAccountChange) {
    if (operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setSaving(true);
    onBusy?.(true);
    setError(undefined);
    try {
      const result = await ctx.remote.dshModelPickerUsage.changeCodexDesktop(input, controller.signal);
      if (controller.signal.aborted) return;
      if (!result.ok || result.value !== 'ok') {
        setError(result.ok && result.value === 'invalidHome' ? 'invalidHome'
          : result.ok && result.value === 'signedOut' ? 'unsignedProfile'
            : result.ok && result.value === 'duplicate' ? 'duplicateAccount' : 'connectionChangeFailed');
        return;
      }
      if (input.kind === 'add') {
        setHome('');
        setLabel('');
        setAdding(false);
      }
      refresh();
    } catch {
      if (!controller.signal.aborted) setError('connectionChangeFailed');
    } finally {
      operation.current = undefined;
      setSaving(false);
      onBusy?.(false);
    }
  }

  return <div className="dsh-connection-method-content">
    {checking && !state && legacy === null && <p role="status">{t('checkingConnection')}</p>}
    <DesktopDetection installed={state?.installed ?? null} signedIn={signedIn} t={t} />
    {state?.installed === false && <p>{t('codexInstall')}</p>}
    {signedIn === false && <p>{t('codexLoginStart')} <code>codex login</code> {t('codexLoginFinish')}</p>}
    {(state?.accounts.length ?? 0) > 0
      ? <ul className="dsh-connection-accounts">
        {state?.accounts.map(account => <li key={account.provider}>
          <div><strong>{account.label || t('localAccount')}</strong>
            <p>{t(account.signedIn ? 'signedIn' : 'signedOut')} · {t(account.modelCount === 1 ? 'modelCountOne' : 'modelCount',
              { count: account.modelCount })}</p>
          </div>
          {account.removable && <button type="button" disabled={saving}
            onClick={() => void change({ kind: 'remove', provider: account.provider })}>{t('remove')}</button>}
        </li>)}
      </ul>
      : legacy === true && !state && <p>{t('codexLocal')}</p>}
    {state?.canManage ? <>
      {configure && !adding && <button type="button" disabled={saving} data-emphasis="true"
        onClick={() => { setError(undefined); setAdding(true); }}><ManagementIcon name="add" />{t('addAccount')}</button>}
      {adding && <form className="dsh-connection-form" aria-label={t('addAccount')} onSubmit={event => {
        event.preventDefault();
        if (home.trim() && label.trim() && !saving) void change({ kind: 'add', home: home.trim(), label: label.trim() });
      }}>
        <label>{t('accountName')}<input required maxLength={80} value={label}
          onChange={event => setLabel(event.currentTarget.value)} /></label>
        <label>{t('accountHome')}<input required value={home} maxLength={4096}
          onChange={event => setHome(event.currentTarget.value)} /></label>
        <p>{t('codexHomeHelp')}</p>
        <div><button type="submit" disabled={saving || !home.trim() || !label.trim()} data-emphasis="true">{t('connect')}</button>
          <button type="button" disabled={saving} onClick={() => {
            setAdding(false); setHome(''); setLabel(''); setError(undefined);
          }}>{t('cancel')}</button></div>
      </form>}
    </> : !checking && <p>{t('codexProviderStorage')}</p>}
    {error && <p role="alert">{t(error)}</p>}
  </div>;
}

export function ApiAccounts({ t, state, change, refresh, configure = false, keyLabel, onBusy }: {
  t: Translate;
  state: CodexApi | null;
  change: (change: CodexApiChange, signal: AbortSignal) => Promise<CodexApiResult>;
  refresh: () => void;
  configure?: boolean;
  keyLabel: string;
  onBusy?: (pending: boolean) => void;
}) {
  const [key, setKey] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<'invalidApiKey' | 'duplicateApiAccount' | 'noApiModels' | 'connectionChangeFailed'>();
  const operation = useRef<AbortController>();
  useEffect(() => () => operation.current?.abort(), []);
  async function update(input: CodexApiChange) {
    if (operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    onBusy?.(true);
    setError(undefined);
    try {
      const result = await change(input, controller.signal);
      if (controller.signal.aborted) return;
      if (result !== 'ok') {
        setError(result === 'invalidKey' ? 'invalidApiKey' : result === 'duplicate' ? 'duplicateApiAccount'
          : result === 'noModels' ? 'noApiModels' : 'connectionChangeFailed');
        return;
      }
      if (input.kind === 'add') { setKey(''); setLabel(''); }
      refresh();
    } catch {
      if (!controller.signal.aborted) setError('connectionChangeFailed');
    } finally {
      operation.current = undefined;
      setBusy(false);
      onBusy?.(false);
    }
  }
  if (!state?.canManage && !state?.accounts.length) return <p>{t('unsupportedMethod')}</p>;
  const accounts = configure ? state.accounts.filter(account => !account.connected) : state.accounts;
  return <div className="dsh-connection-method-content">
    {configure && state.canManage && <form className="dsh-connection-form" onSubmit={event => {
      event.preventDefault();
      if (key.trim() && label.trim() && !busy) void update({ kind: 'add', label: label.trim(), key: key.trim() });
    }}>
      <label>{keyLabel}<input autoComplete="off" type="password" value={key} maxLength={8192}
        onChange={event => setKey(event.currentTarget.value)} required /></label>
      <label>{t('accountName')}<input value={label} maxLength={80}
        onChange={event => setLabel(event.currentTarget.value)} required /></label>
      <div><button type="submit" data-emphasis="true" disabled={busy || !key.trim() || !label.trim()}>{t('connect')}</button></div>
    </form>}
    {accounts.length > 0 ? <ul className="dsh-connection-accounts">
      {accounts.map(account => <li key={account.provider}>
        <div><strong>{account.label}</strong>
          <p>{account.connected ? t('connected') : t('connectionFailed')} · {t(account.modelCount === 1 ? 'modelCountOne' : 'modelCount',
            { count: account.modelCount })}</p>
        </div>
        <div className="dsh-connection-actions">
          {state.canManage && <button type="button" disabled={busy}
            onClick={() => void update({ kind: 'refresh', provider: account.provider })}>{t('checkConnection')}</button>}
          {state.canManage && <button type="button" disabled={busy}
            onClick={() => void update({ kind: 'remove', provider: account.provider })}>{t('remove')}</button>}
        </div>
      </li>)}
    </ul> : !configure && <p>{t('noApiAccounts')}</p>}
    {error && <p role="alert">{t(error)}</p>}
  </div>;
}
