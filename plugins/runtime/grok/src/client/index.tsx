import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-api-remotes/client';
import type {} from '@deepseek-ai/dsh-client-locale/client';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type {} from '@deepseek-ai/dsh-client-ui-settings/client';
import type { ModelPickerConnectionsOwner, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';
import { type ReactNode, useEffect, useRef, useState } from 'react';
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
    setup: 'Set up Grok', manage: 'View connection', details: 'Grok connection details',
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

function GrokConnection({ ctx, t, renderCard, refresh = 0 }:
  PropsLocale<'grokConnection'> & { ctx: Context } & ModelPickerConnectionsOwner) {
  const [view, setView] = useState<ConnectionView | null>(null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(true);
  const [failure, setFailure] = useState(false);

  const revision = useRef(0);
  useEffect(() => {
    const request = ++revision.current;
    setBusy(true);
    setFailure(false);
    void ctx.remote.dshGrokConnection.read(refresh > 0).then(result => {
      if (request === revision.current) setView(result.ok ? result.value : null);
    }).catch(() => {
      if (request === revision.current) setView(null);
    }).finally(() => {
      if (request === revision.current) setBusy(false);
    });
    return () => { ++revision.current; };
  }, [ctx, refresh]);

  async function perform(action: Change | 'refresh') {
    const request = ++revision.current;
    setBusy(true);
    setFailure(false);
    setKey('');
    try {
      const remote = ctx.remote.dshGrokConnection;
      const result = await (action === 'refresh' ? remote.read(true) : remote.update(action));
      if (request !== revision.current) return;
      if (!result.ok || !result.value) setFailure(true);
      else setView(result.value);
    } catch {
      if (request === revision.current) setFailure(true);
    } finally {
      if (request === revision.current) setBusy(false);
    }
  }

  const connected = view?.state === 'connected';
  const modelCount = connected ? t(view.modelCount === 1 ? 'modelCountOne' : 'modelCount', {
    count: view.modelCount,
  }) : undefined;
  const status = busy ? 'checking' : view?.state ?? 'noAccess';
  const details = <section aria-label={t('details')} style={{ display: 'grid', gap: 10, padding: 16 }}>
    <h2>{renderCard ? t('details') : 'Grok'}</h2>
    {!renderCard && <p role="status">{t(status)}{modelCount && <> · {modelCount}</>}</p>}
    {view && <>
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
  if (!renderCard) return details;
  return renderCard({
    id: 'grok', name: 'Grok', status: t(status), tone: busy ? 'neutral' : connected ? 'ready' : 'warning',
    description: modelCount, footer: t('key'), action: t(connected ? 'manage' : 'setup'), details,
  });
}
