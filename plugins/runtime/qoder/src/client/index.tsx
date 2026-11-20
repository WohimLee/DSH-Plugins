import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-api-remotes';
import type {} from '@deepseek-ai/dsh-client-locale/client';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type {} from '@deepseek-ai/dsh-client-ui-settings/client';
import type { ReactNode } from 'react';
import type { ModelPickerConnectionsOwner, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';
import { useCallback, useEffect, useRef, useState } from 'react';
import { contribution } from '../remote.js';
import type { AccountChange, AccountView, LoginAction, LoginView } from '../remote.js';

const messages = {
  en: {
    title: 'Qoder accounts', intro: 'Use your Qoder CLI sign-in, or bind an account with a personal access token (PAT).',
    setup: 'Set up Qoder', manage: 'Manage accounts', setupRequired: 'Setup required', cliMissingShort: 'Qoder CLI is missing.',
    connectedAccountsOne: '{count} connected account', connectedAccounts: '{count} connected accounts',
    create: 'Open Qoder Account Integrations', refresh: 'Refresh accounts', loading: 'Checking Qoder accounts…',
    noModels: 'Qoder returned no selectable models.', unavailable: 'Could not load the model catalog. Check the connection and try again.',
    unbound: 'Account not bound', cliMissing: 'Qoder CLI is missing. Install it or set cliPath in the plugin configuration.',
    authFailed: 'Qoder rejected this account’s PAT. Check or replace its token.',
    cliAuthFailed: 'Connect your Qoder account to load its models.',
    login: 'Connect Qoder', preparing: 'Preparing your sign-in link…', waiting: 'Confirm your account in the browser. Models will refresh automatically.',
    openLogin: 'Open Qoder sign-in', cancel: 'Cancel sign-in', expired: 'The sign-in link expired. Start again to get a new link.',
    loginFailed: 'Could not complete sign-in. Check your connection and try again.', authorized: 'Browser authorization completed.',
    connected: 'Connected', model: 'available model', models: 'available models', token: 'Personal access token', save: 'Bind account',
    replace: 'Replace token', remove: 'Unbind', failed: 'Could not save the account change.',
    cannotBind: 'Account settings are unavailable in this session.', add: 'Add account', remark: 'Remark', optionalRemark: 'Remark (optional)', saveRemark: 'Save remark',
  },
  zh: {
    title: 'Qoder 账号', intro: '使用本机 Qoder CLI 登录，或使用个人访问令牌（PAT）绑定账号。',
    setup: '设置 Qoder', manage: '管理账号', setupRequired: '需要设置', cliMissingShort: '未找到 Qoder CLI。',
    connectedAccountsOne: '{count} 个已连接账号', connectedAccounts: '{count} 个已连接账号',
    create: '打开 Qoder 账号集成设置', refresh: '刷新账号', loading: '正在检查 Qoder 账号…',
    noModels: 'Qoder 暂未返回可选模型。', unavailable: '未能读取模型目录，请检查连接后重试。',
    unbound: '账号尚未绑定', cliMissing: '未找到 Qoder CLI，请安装后重试，或在插件配置中填写 cliPath。',
    authFailed: 'Qoder 拒绝了这个账号的 PAT，请检查或替换令牌。',
    cliAuthFailed: '连接 Qoder 账号即可加载可用模型。',
    login: '连接 Qoder', preparing: '正在准备授权链接…', waiting: '请在浏览器中确认账号。完成后，这里会自动刷新模型。',
    openLogin: '前往 Qoder 授权', cancel: '取消授权', expired: '授权链接已过期，请重新连接。',
    loginFailed: '未能完成授权，请检查连接后重试。', authorized: '浏览器授权已完成。',
    connected: '已连接', model: '个可用模型', models: '个可用模型', token: '个人访问令牌', save: '绑定账号',
    replace: '更换令牌', remove: '解绑', failed: '未能保存账号修改。',
    cannotBind: '当前会话无法使用 Qoder 账号设置。', add: '添加账号', remark: '备注', optionalRemark: '备注（可选）', saveRemark: '保存备注',
  },
};

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { qoderAccounts: keyof typeof messages.en }
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
    const binding = ctx.inject(['remote.dshQoderAccounts'], register);
    return async () => { try { await binding.dispose(); } finally { await unmount(); } };
  } catch (error) {
    await unmount();
    throw error;
  }
}

function register(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('qoderAccounts', messages));
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'dsh-qoder-accounts', order: 11, locale: 'qoderAccounts',
    label: 'Qoder',
  }, ({ t }) => <AccountSettings ctx={ctx} t={t} />));
  ctx.slots.inject('modelPicker.connections', () => ctx.slots.register({
    name: 'modelPicker.connections', id: 'qoder', locale: 'qoderAccounts',
  }, ({ t, renderCard, refresh }) => <AccountSettings {...{ ctx, t, renderCard, refresh }} />));
}

type Translate = PropsLocale<'qoderAccounts'>['t'];

function accountStatus(account: AccountView, t: Translate) {
  return t(account.state === 'authFailed' && account.browserLogin ? 'cliAuthFailed' : account.state);
}

function AccountSettings({ ctx, t, renderCard, refresh = 0 }:
  { ctx: Context; t: Translate } & ModelPickerConnectionsOwner) {
  const [accounts, setAccounts] = useState<AccountView[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const revision = useRef(0);
  const busy = loading || saving;

  const reload = useCallback(async (refreshAccounts: boolean) => {
    const latest = ++revision.current;
    setLoading(true);
    try {
      const result = await ctx.remote.dshQoderAccounts.list(refreshAccounts);
      if (latest !== revision.current) return;
      if (!result.ok || !result.value.length) {
        setError(true);
        return;
      }
      setAccounts(result.value);
      setError(false);
    } catch {
      if (latest === revision.current) setError(true);
    } finally {
      if (latest === revision.current) setLoading(false);
    }
  }, [ctx]);

  useEffect(() => {
    void reload(refresh > 0);
    return () => { revision.current++; };
  }, [reload, refresh]);

  async function update(change: AccountChange): Promise<boolean> {
    setSaving(true);
    try {
      const result = await ctx.remote.dshQoderAccounts.change(change);
      if (!result.ok || !result.value) return false;
      await reload(false);
      return true;
    } catch {
      return false;
    } finally {
      setSaving(false);
    }
  }

  const details = <section aria-label={t('title')} style={{ padding: 16, display: 'grid', gap: 12 }}>
    <h2>{t('title')}</h2>
    <p>{t('intro')}</p>
    {!renderCard && <div>
      <button type="button" disabled={busy} onClick={() => { void reload(true); }}>{t('refresh')}</button>
    </div>}
    {busy && <p role="status">{t('loading')}</p>}
    {error && <p role="alert">{t('cannotBind')}</p>}
    {accounts.some(account => account.browserLogin && account.state !== 'cliMissing' && account.state !== 'connected') &&
      <LoginGuide ctx={ctx} t={t} reload={reload} />}
    {accounts.some(account => account.state === 'cliMissing') && <a href="https://docs.qoder.com/cli/installation"
      target="_blank" rel="noreferrer">Qoder CLI ↗</a>}
    {!error && <AddAccount {...{ busy, t, update }} />}
    {accounts.map(account => <AccountCard key={account.provider} {...{ account, busy, t, update }} />)}
  </section>;

  if (!renderCard) return details;
  const connectedCount = accounts.filter(account => account.state === 'connected').length;
  const connected = connectedCount > 0;
  const status = error ? 'cannotBind' : loading && accounts.length === 0 ? 'loading' : connected ? 'connected' : 'setupRequired';
  const problem = accounts.find(account => !['connected', 'unbound'].includes(account.state));
  const description = error || connected ? undefined : problem?.state === 'cliMissing' ? t('cliMissingShort')
    : problem ? accountStatus(problem, t) : status === 'setupRequired' ? t('unbound') : undefined;
  return renderCard({
    id: 'qoder', name: 'Qoder', status: t(status), tone: status === 'loading' ? 'neutral' : connected && !error ? 'ready' : 'warning',
    description, footer: connected && !error
      ? t(connectedCount === 1 ? 'connectedAccountsOne' : 'connectedAccounts', { count: connectedCount }) : undefined,
    action: connected ? t('manage') : t('setup'), details,
  });
}

function LoginGuide({ ctx, t, reload }: {
  ctx: Context; t: Translate; reload: (refresh: boolean) => Promise<void>;
}) {
  const [view, setView] = useState<LoginView>({ state: 'idle' });
  const [busy, setBusy] = useState(false);
  const revision = useRef(0);
  const request = useCallback(async (action: LoginAction) => {
    const id = ++revision.current;
    if (action !== 'status') setBusy(true);
    try {
      const result = await ctx.remote.dshQoderAccounts.login(action);
      if (id !== revision.current) return;
      const next: LoginView = result.ok ? result.value : { state: 'failed' };
      setView(next);
      if (next.state === 'authorized') await reload(false);
    } catch {
      if (id === revision.current) setView({ state: 'failed' });
    } finally {
      if (id === revision.current) setBusy(false);
    }
  }, [ctx, reload]);
  useEffect(() => {
    void request('status');
    return () => { revision.current++; };
  }, [request]);
  const active = view.state === 'preparing' || view.state === 'waiting';
  useEffect(() => {
    if (!active || busy) return;
    const timer = setTimeout(() => { void request('status'); }, 800);
    return () => clearTimeout(timer);
  }, [view, active, busy, request]);
  return <div>
    {view.state !== 'idle' && <p role="status">{t(view.state === 'failed' ? 'loginFailed' : view.state)}</p>}
    {view.state === 'waiting' && view.url && <p><a href={view.url} target="_blank" rel="noreferrer">{t('openLogin')} ↗</a></p>}
    <button type="button" disabled={busy} onClick={() => { void request(active ? 'cancel' : 'start'); }}>
      {t(active ? 'cancel' : 'login')}
    </button>
  </div>;
}

type AccountActions = {
  busy: boolean;
  update: (change: AccountChange) => Promise<boolean>;
  t: Translate;
};

function AddAccount({ busy, update, t }: AccountActions) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState('');
  const [remark, setRemark] = useState('');
  const [failed, setFailed] = useState(false);

  return <div>
    <button type="button" aria-expanded={open} disabled={busy} onClick={() => setOpen(!open)}>{t('add')}</button>
    {open && <form aria-label={t('add')} style={{ display: 'grid', gap: 8, marginTop: 8 }}
      onSubmit={async event => {
        event.preventDefault();
        if (!token.trim() || busy) return;
        const saved = await update({ kind: 'add', token: token.trim(), remark: remark.trim() });
        setFailed(!saved);
        if (saved) {
          setOpen(false);
          setToken('');
          setRemark('');
        }
      }}>
      <a href="https://qoder.com/account/integrations" target="_blank" rel="noreferrer">{t('create')}</a>
      <label>{t('token')} <input type="password" autoComplete="off" maxLength={8192} value={token}
        disabled={busy} onChange={event => setToken(event.currentTarget.value)} /></label>
      <label>{t('optionalRemark')} <input value={remark} disabled={busy} maxLength={80}
        onChange={event => setRemark(event.currentTarget.value)} /></label>
      <div><button type="submit" disabled={busy || !token.trim()}>{t('save')}</button></div>
      {failed && <p role="alert">{t('failed')}</p>}
    </form>}
  </div>;
}

function AccountCard({ account, busy, update, t }: AccountActions & { account: AccountView }) {
  const { provider, name, state } = account;
  const [remark, setRemark] = useState(account.remark ?? '');
  const [token, setToken] = useState('');
  const [failed, setFailed] = useState(false);

  useEffect(() => { setRemark(account.remark ?? ''); }, [account.remark]);

  return <fieldset style={{ border: '1px solid var(--dsw-alias-border-l1, GrayText)', borderRadius: 8, padding: 12 }}>
    <legend>{name}</legend>
    <p>{accountStatus(account, t)}{state === 'connected' ? ` · ${account.modelCount} ${t(account.modelCount === 1 ? 'model' : 'models')}` : ''}</p>
    {account.remark !== undefined && <>
      <form onSubmit={async event => {
        event.preventDefault();
        if (busy || remark.trim() === account.remark) return;
        const saved = await update({ kind: 'remark', provider, remark: remark.trim() });
        setFailed(!saved);
        if (saved) setRemark(remark.trim());
      }}>
        <label>{t('remark')} <input value={remark} disabled={busy} maxLength={80}
          onChange={event => setRemark(event.currentTarget.value)} /></label>
        <button type="submit" disabled={busy || remark.trim() === account.remark}>{t('saveRemark')}</button>
      </form>
      <form style={{ marginTop: 8 }} onSubmit={async event => {
        event.preventDefault();
        if (!token.trim() || busy) return;
        const saved = await update({ kind: 'replace', provider, token: token.trim() });
        setFailed(!saved);
        if (saved) setToken('');
      }}>
        <label>{t('token')} <input type="password" autoComplete="off" maxLength={8192} value={token}
          disabled={busy} onChange={event => setToken(event.currentTarget.value)} /></label>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button type="submit" disabled={busy || !token.trim()}>{t(state === 'unbound' ? 'save' : 'replace')}</button>
          {state !== 'unbound' && <button type="button" disabled={busy} onClick={async () => {
            const removed = await update({ kind: 'unbind', provider });
            setFailed(!removed);
            if (removed) setToken('');
          }}>{t('remove')}</button>}
        </div>
      </form>
      {failed && <p role="alert">{t('failed')}</p>}
    </>}
  </fieldset>;
}
