import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-api-remotes';
import type {} from '@deepseek-ai/dsh-client-locale/client';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type {} from '@deepseek-ai/dsh-client-ui-settings/client';
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';
import { useEffect, useState } from 'react';
import { contribution } from '../remote.js';
import type { AccountChange, AccountView } from '../remote.js';

const messages = {
  en: {
    title: 'Qoder accounts', intro: 'Create a personal access token (PAT) in each Qoder account, then add the account here.',
    create: 'Open Qoder Account Integrations', refresh: 'Refresh accounts', loading: 'Checking Qoder accounts…',
    noModels: 'Qoder returned no selectable models.', unavailable: 'Could not load the model catalog. Check the connection and try again.',
    unbound: 'Account not bound', cliMissing: 'Qoder CLI is missing. Install it or set cliPath in the plugin configuration.',
    authFailed: 'Authentication failed. Check the PAT or sign in again in Qoder CLI.',
    connected: 'Connected', model: 'available model', models: 'available models', token: 'Personal access token', save: 'Bind account',
    replace: 'Replace token', remove: 'Unbind', failed: 'Could not save the account change.',
    cannotBind: 'Account settings are unavailable in this session.', add: 'Add account', remark: 'Remark', optionalRemark: 'Remark (optional)', saveRemark: 'Save remark',
  },
  zh: {
    title: 'Qoder 账号', intro: '在每个 Qoder 账号中创建个人访问令牌（PAT），然后在这里添加账号。',
    create: '打开 Qoder 账号集成设置', refresh: '刷新账号', loading: '正在检查 Qoder 账号…',
    noModels: 'Qoder 暂未返回可选模型。', unavailable: '未能读取模型目录，请检查连接后重试。',
    unbound: '账号尚未绑定', cliMissing: '未找到 Qoder CLI，请安装后重试，或在插件配置中填写 cliPath。',
    authFailed: 'Qoder 认证失败，请检查 PAT 或重新登录 Qoder CLI。',
    connected: '已连接', model: '个可用模型', models: '个可用模型', token: '个人访问令牌', save: '绑定账号',
    replace: '更换令牌', remove: '解绑', failed: '未能保存账号修改。',
    cannotBind: '当前会话无法使用 Qoder 账号设置。', add: '添加账号', remark: '备注', optionalRemark: '备注（可选）', saveRemark: '保存备注',
  },
};

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { qoderAccounts: keyof typeof messages.en }
  interface SlotMap {
    'modelPicker.connections': { kind: 'list'; scope: 'root' }
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
  }, ({ t }) => <AccountSettings ctx={ctx} t={t} />));
}

type Translate = PropsLocale<'qoderAccounts'>['t'];

function AccountSettings({ ctx, t }: { ctx: Context; t: Translate }) {
  const [accounts, setAccounts] = useState<AccountView[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState(false);

  async function reload(refresh: boolean) {
    try {
      const result = await ctx.remote.dshQoderAccounts.list(refresh);
      if (!result.ok || !result.value.length) {
        setError(true);
        return;
      }
      setAccounts(result.value);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { void reload(false); }, [ctx]);

  async function update(change: AccountChange): Promise<boolean> {
    setBusy(true);
    try {
      const result = await ctx.remote.dshQoderAccounts.change(change);
      if (!result.ok || !result.value) return false;
      await reload(false);
      return true;
    } catch {
      return false;
    } finally {
      setBusy(false);
    }
  }

  return <section aria-label={t('title')} style={{ padding: 16, display: 'grid', gap: 12 }}>
    <h2>{t('title')}</h2>
    <p>{t('intro')} <a href="https://qoder.com/account/integrations" target="_blank" rel="noreferrer">{t('create')}</a></p>
    <div>
      <button type="button" disabled={busy} onClick={() => { setBusy(true); void reload(true); }}>{t('refresh')}</button>
      {busy && <p role="status">{t('loading')}</p>}
      {error && <p role="alert">{t('cannotBind')}</p>}
    </div>
    {!error && <AddAccount {...{ busy, t, update }} />}
    {accounts.map(account => <AccountCard key={account.provider} {...{ account, busy, t, update }} />)}
  </section>;
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
    <p>{t(state)}{state === 'connected' ? ` · ${account.modelCount} ${t(account.modelCount === 1 ? 'model' : 'models')}` : ''}</p>
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
