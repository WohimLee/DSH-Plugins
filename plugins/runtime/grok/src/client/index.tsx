import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-api-remotes/client';
import type {} from '@deepseek-ai/dsh-client-locale/client';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type {} from '@deepseek-ai/dsh-client-ui-settings/client';
import type { ModelPickerConnectionCard, ModelPickerConnectionsOwner, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { contribution } from '../remote.js';
import type { Change, ConnectionView } from '../remote.js';

const messages = {
  en: {
    unbound: 'Grok is not connected', connected: 'Connected with an xAI API Key',
    modelCountOne: '{count} model', modelCount: '{count} models',
    connectedAccounts: '{count} connected accounts',
    noAccess: 'Grok connection settings are unavailable in this session.',
    unauthorized: 'xAI rejected the API Key. Check the key and its permissions.',
    unavailable: 'Could not load the Grok model catalog. Try again.',
    empty: 'This API Key has no available Grok chat models.',
    storage: 'Could not save the Grok connection. Check the DSH credential store.',
    key: 'xAI API Key', connect: 'Connect', replace: 'Replace key', disconnect: 'Disconnect', refresh: 'Refresh models',
    accountName: 'Account name', defaultAccount: 'Default account', apiAccounts: 'Grok API accounts',
    noAccounts: 'No API accounts connected.',
    replaceFor: 'Replace key for {name}', disconnectFor: 'Disconnect {name}', cancel: 'Cancel',
    setup: 'Set up Grok', manage: 'View connection', details: 'Grok connection details',
    checking: 'Checking Grok connection…',
    console: 'Open xAI Console', billing: 'API credits and usage are available in the xAI Console.',
  },
  zh: {
    unbound: 'Grok 尚未连接', connected: '已通过 xAI API Key 连接',
    modelCountOne: '{count} 个模型', modelCount: '{count} 个模型',
    connectedAccounts: '{count} 个已连接账号',
    noAccess: '当前会话无法管理 Grok 连接。',
    unauthorized: 'xAI 拒绝了 API Key，请检查密钥及其权限。',
    unavailable: '暂时无法读取 Grok 模型目录，请重试。',
    empty: '此 API Key 暂无可用的 Grok 对话模型。',
    storage: '未能保存 Grok 连接，请检查 DSH 凭据存储。',
    key: 'xAI API Key', connect: '连接', replace: '更换密钥', disconnect: '断开连接', refresh: '刷新模型',
    accountName: '账号名称', defaultAccount: '默认账号', apiAccounts: 'Grok API 账号',
    noAccounts: '尚未连接 API 账号。',
    replaceFor: '更换 {name} 的密钥', disconnectFor: '断开 {name}', cancel: '取消',
    setup: '设置 Grok', manage: '查看连接', details: 'Grok 连接详情',
    checking: '正在检查 Grok 连接…',
    console: '打开 xAI 控制台', billing: '可在 xAI 控制台查看 API 余额和用量。',
  },
};

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { grokConnection: keyof typeof messages.en }
  interface ModelPickerConnectionCard {
    id: string;
    name: string;
    status: string;
    tone: 'neutral' | 'ready' | 'warning';
    description?: string;
    footer?: string;
    action: string;
    details: ReactNode;
  }
  interface ModelPickerConnectionsOwner {
    renderCard?: (card: ModelPickerConnectionCard) => ReactNode;
    refresh?: number;
  }
  interface SlotMap {
    'modelPicker.connections': { kind: 'list'; scope: 'root'; owner: ModelPickerConnectionsOwner }
  }
}

export const inject = ['slots', 'locale', 'remote'];

export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const unmount = await ctx.remote.$mount(contribution);
  try {
    const binding = ctx.inject(['remote.dshGrokConnection'], register);
    return async () => { try { await binding.dispose(); } finally { await unmount(); } };
  } catch (error) {
    await unmount();
    throw error;
  }
}

function register(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('grokConnection', messages));
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'dsh-grok-connection', label: 'Grok', locale: 'grokConnection',
  }, ({ t }) => <GrokConnection ctx={ctx} t={t} />));
  ctx.slots.inject('modelPicker.connections', () => ctx.slots.register({
    name: 'modelPicker.connections', id: 'grok', locale: 'grokConnection',
  }, ({ t, renderCard, refresh }) => <GrokConnection {...{ ctx, t, renderCard, refresh }} />));
}

const inputStyle = {
  minWidth: 0, padding: '6px 8px', borderRadius: 6,
  border: '1px solid var(--dsw-alias-border-l1, GrayText)', background: 'transparent', color: 'inherit',
};

function AccountForm({ t, busy, replacement, cancel, perform }: PropsLocale<'grokConnection'> & {
  busy: boolean;
  replacement?: string;
  cancel?: () => void;
  perform: (action: Change) => Promise<boolean>;
}) {
  const [key, setKey] = useState('');
  const [label, setLabel] = useState('');
  const submit = async () => {
    const trimmed = key.trim();
    if (!trimmed || busy || (!replacement && !label.trim())) return;
    setKey('');
    if (replacement) await perform({ kind: 'replace', key: trimmed, id: replacement });
    else if (await perform({ kind: 'add', key: trimmed, label: label.trim() })) setLabel('');
  };
  return <form aria-label="Grok" className="dsh-connection-form" style={{ display: 'grid', gap: 8 }}
    onSubmit={event => { event.preventDefault(); void submit(); }}>
    <label style={{ display: 'grid', gap: 4 }}>
      {t('key')}
      <input type="password" autoComplete="off" spellCheck={false} maxLength={4096} value={key} disabled={busy} required
        onChange={event => setKey(event.currentTarget.value)} style={inputStyle} />
    </label>
    {!replacement && <label style={{ display: 'grid', gap: 4 }}>
      {t('accountName')}
      <input type="text" autoComplete="off" maxLength={80} value={label} disabled={busy} required
        onChange={event => setLabel(event.currentTarget.value)} style={inputStyle} />
    </label>}
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {replacement && <button type="button" disabled={busy} onClick={cancel}>{t('cancel')}</button>}
      <button type="submit" data-emphasis="true" disabled={busy || !key.trim() || (!replacement && !label.trim())}>
        {t(replacement ? 'replace' : 'connect')}
      </button>
    </div>
  </form>;
}

function GrokConnection({ ctx, t, renderCard, refresh = 0 }:
  PropsLocale<'grokConnection'> & { ctx: Context } & ModelPickerConnectionsOwner) {
  const [view, setView] = useState<ConnectionView | null>(null);
  const [replacement, setReplacement] = useState<string>();
  const [busy, setBusy] = useState(true);
  const [mutating, setMutating] = useState(false);
  const [failure, setFailure] = useState(false);

  const revision = useRef(0);
  const changing = useRef(false);
  useEffect(() => {
    const read = (probe: boolean, foreground: boolean) => {
      if (!foreground && changing.current) return;
      const request = ++revision.current;
      if (foreground) {
        setBusy(true);
        setFailure(false);
      }
      void ctx.remote.dshGrokConnection.read(probe).then(result => {
        if (request !== revision.current) return;
        if (!result.ok || !result.value) setFailure(true);
        else setView(result.value);
      }).catch(() => {
        if (request === revision.current) setFailure(true);
      }).finally(() => {
        if (request === revision.current) setBusy(false);
      });
    };
    const stop = ctx.remote.$on('llm/adapters-updated', () => read(false, false));
    read(refresh > 0, true);
    return () => { ++revision.current; stop(); };
  }, [ctx, refresh]);

  async function perform(action: Change | 'refresh') {
    if (changing.current) return false;
    changing.current = true;
    const request = ++revision.current;
    setBusy(true);
    if (action !== 'refresh') setMutating(true);
    setFailure(false);
    try {
      const remote = ctx.remote.dshGrokConnection;
      const result = await (action === 'refresh' ? remote.read(true) : remote.update(action));
      if (request !== revision.current) return false;
      if (!result.ok || !result.value) {
        setFailure(true);
        return false;
      }
      setView(result.value);
      if (!result.value.error && action !== 'refresh' && action.kind === 'replace') setReplacement(undefined);
      return !result.value.error;
    } catch {
      if (request === revision.current) setFailure(true);
      return false;
    } finally {
      changing.current = false;
      if (action !== 'refresh') setMutating(false);
      if (request === revision.current) setBusy(false);
    }
  }

  const accountCount = view?.accounts.filter(account => account.state === 'connected').length ?? 0;
  const connected = accountCount > 0;
  const modelCount = connected && view ? t(view.modelCount === 1 ? 'modelCountOne' : 'modelCount', {
    count: view.modelCount,
  }) : undefined;
  const status = busy ? 'checking' : view?.state ?? 'noAccess';
  const statusLabel = accountCount > 1 && !busy ? t('connectedAccounts', { count: accountCount }) : t(status);
  const feedback = <>
    {busy && <p role="status">{t('checking')}</p>}
    {!view && !busy && <p role="status">{t('noAccess')}</p>}
    {view?.error && <p role="alert">{t(view.error)}</p>}
    {failure && <p role="alert">{t('unavailable')}</p>}
  </>;
  const billing = <p>{t('billing')} <a href="https://console.x.ai/" target="_blank" rel="noreferrer">{t('console')}</a></p>;
  const api = (add: boolean) => <section aria-label={t('apiAccounts')} style={{ display: 'grid', gap: 12 }}>
    {feedback}
    {view && <>
      {view.accounts.length > 0 ? <ul className="dsh-connection-accounts" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {view.accounts.map(account => {
          const name = account.label ?? t('defaultAccount');
          return <li key={account.id} style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, padding: '8px 0',
            borderBottom: '1px solid var(--dsw-alias-border-l1, GrayText)', overflowWrap: 'anywhere' }}>
            <div style={{ flex: '1 1 150px' }}>
              <strong>{name}</strong>
              <p>{account.state === 'connected' ? t(account.modelCount === 1 ? 'modelCountOne' : 'modelCount',
                { count: account.modelCount }) : t(account.state)}</p>
            </div>
            <button type="button" aria-label={t('replaceFor', { name })} disabled={busy} onClick={() => {
              setReplacement(account.id);
            }}>{t('replace')}</button>
            <button type="button" aria-label={t('disconnectFor', { name })} disabled={busy} onClick={() => {
              if (replacement === account.id) setReplacement(undefined);
              void perform({ kind: 'disconnect', id: account.id });
            }}>{t('disconnect')}</button>
          </li>;
        })}
      </ul> : <p>{t('noAccounts')}</p>}
      {(add || replacement) && <AccountForm key={replacement ?? 'add'} {...{ t, busy, replacement, perform }}
        cancel={() => setReplacement(undefined)} />}
      {view.state !== 'unbound' && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button type="button" disabled={busy} onClick={() => { void perform('refresh'); }}>{t('refresh')}</button>
      </div>}
    </>}
    {billing}
  </section>;
  const details = <section aria-label={t('details')} style={{ display: 'grid', gap: 10, padding: 16 }}>
    <h2>{renderCard ? t('details') : 'Grok'}</h2>
    {!renderCard && <p role="status">{statusLabel}{modelCount && <> · {modelCount}</>}</p>}
    {api(true)}
  </section>;
  if (!renderCard) return details;
  const card: ModelPickerConnectionCard & {
    connection: { connected: boolean; accountCount: number; busy: boolean; api: ReactNode; setup: { api: ReactNode } };
  } = {
    id: 'grok', name: 'Grok', status: statusLabel, tone: busy ? 'neutral' : connected ? 'ready' : 'warning',
    description: modelCount, footer: t('key'), action: t(connected ? 'manage' : 'setup'), details,
    connection: { connected, accountCount, busy: mutating, api: api(false), setup: { api: <section aria-label={t('apiAccounts')}>
      {feedback}
      {view && <AccountForm {...{ t, busy, perform }} />}
    </section> } },
  };
  return renderCard(card);
}
