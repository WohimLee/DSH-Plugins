import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-api-remotes/client';
import type {} from '@deepseek-ai/dsh-client-locale/client';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type {} from '@deepseek-ai/dsh-client-ui-settings/client';
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';
import { useEffect, useState } from 'react';
import { contribution } from '../remote.js';
import type { Change, ConnectionView } from '../remote.js';

const messages = {
  en: {
    unbound: 'Grok is not connected', connected: 'Connected with an xAI API Key',
    modelCountOne: '{count} model', modelCount: '{count} models',
    noAccess: 'Grok connection settings are unavailable in this session.',
    unauthorized: 'xAI rejected the API Key. Check the key and its permissions.',
    unavailable: 'Could not load the Grok model catalog. Try again.',
    empty: 'This API Key has no available Grok chat models.',
    storage: 'Could not save the Grok connection. Check the DSH credential store.',
    key: 'xAI API Key', connect: 'Connect', replace: 'Replace key', disconnect: 'Disconnect', refresh: 'Refresh models',
    checking: 'Checking Grok connection…',
    console: 'Open xAI Console', billing: 'API credits and usage are available in the xAI Console.',
  },
  zh: {
    unbound: 'Grok 尚未连接', connected: '已通过 xAI API Key 连接',
    modelCountOne: '{count} 个模型', modelCount: '{count} 个模型',
    noAccess: '当前会话无法管理 Grok 连接。',
    unauthorized: 'xAI 拒绝了 API Key，请检查密钥及其权限。',
    unavailable: '暂时无法读取 Grok 模型目录，请重试。',
    empty: '此 API Key 暂无可用的 Grok 对话模型。',
    storage: '未能保存 Grok 连接，请检查 DSH 凭据存储。',
    key: 'xAI API Key', connect: '连接', replace: '更换密钥', disconnect: '断开连接', refresh: '刷新模型',
    checking: '正在检查 Grok 连接…',
    console: '打开 xAI 控制台', billing: '可在 xAI 控制台查看 API 余额和用量。',
  },
};

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { grokConnection: keyof typeof messages.en }
  interface SlotMap { 'modelPicker.connections': { kind: 'list'; scope: 'root' } }
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
  }, ({ t }) => <GrokConnection ctx={ctx} t={t} />));
}

function GrokConnection({ ctx, t }: PropsLocale<'grokConnection'> & { ctx: Context }) {
  const [view, setView] = useState<ConnectionView | null>(null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(true);
  const [failure, setFailure] = useState(false);

  useEffect(() => {
    let active = true;
    void ctx.remote.dshGrokConnection.read(false).then(result => {
      if (active && result.ok) setView(result.value);
    }).catch(() => {}).finally(() => {
      if (active) setBusy(false);
    });
    return () => { active = false; };
  }, [ctx]);

  async function perform(action: Change | 'refresh') {
    setBusy(true);
    setFailure(false);
    setKey('');
    try {
      const remote = ctx.remote.dshGrokConnection;
      const result = await (action === 'refresh' ? remote.read(true) : remote.update(action));
      if (!result.ok || !result.value) setFailure(true);
      else setView(result.value);
    } catch {
      setFailure(true);
    } finally {
      setBusy(false);
    }
  }

  const connected = view?.state === 'connected';
  return <section aria-label="Grok" style={{ display: 'grid', gap: 10, padding: 16 }}>
    <h2>Grok</h2>
    {busy && <p role="status">{t('checking')}</p>}
    {!busy && !view && <p role="alert">{t('noAccess')}</p>}
    {view && <>
      <p><span>{t(view.state)}</span>{connected && <> · {t(view.modelCount === 1 ? 'modelCountOne' : 'modelCount', {
        count: view.modelCount,
      })}</>}</p>
      <form aria-label="Grok" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'end', gap: 8 }}
        onSubmit={event => {
          event.preventDefault();
          if (key.trim() && !busy) void perform({ kind: 'connect', key: key.trim() });
        }}>
        <label style={{ display: 'grid', flex: '1 1 210px', gap: 4 }}>
          {t('key')}
          <input type="password" autoComplete="off" spellCheck={false} maxLength={4096} value={key} disabled={busy}
            onChange={event => setKey(event.currentTarget.value)}
            style={{ minWidth: 0, padding: '6px 8px', borderRadius: 6,
              border: '1px solid var(--dsw-alias-border-l1, GrayText)', background: 'transparent', color: 'inherit' }} />
        </label>
        <button type="submit" disabled={busy || !key.trim()}>{t(connected ? 'replace' : 'connect')}</button>
      </form>
      {view.state !== 'unbound' && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button type="button" disabled={busy} onClick={() => { void perform('refresh'); }}>{t('refresh')}</button>
        <button type="button" disabled={busy} onClick={() => { void perform({ kind: 'disconnect' }); }}>{t('disconnect')}</button>
      </div>}
      {view.error && <p role="alert">{t(view.error)}</p>}
      {failure && <p role="alert">{t('unavailable')}</p>}
    </>}
    <p>{t('billing')} <a href="https://console.x.ai/" target="_blank" rel="noreferrer">{t('console')}</a></p>
  </section>;
}
