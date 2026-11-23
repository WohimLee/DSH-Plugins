import { useEffect, useMemo, useRef, useState } from 'react';
import type { SessionListState, SessionReference } from '@deepseek-ai/dsh-api-session-controller/client';
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client';
import type { ConversationViewsProps } from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { PropsLocale, PropsRenderFactories, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { SessionId } from '../workspace/commands.js';

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap { 'workbench.agent.record': { kind: 'single'; scope: 'session' } }
}
declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap { workbenchRecord: unknown }
}

type Entry = NonNullable<SessionListState['projectionsBySession'][SessionId]['values']['subagentCatalog']>[number];
type Row = Entry & { parent: SessionId; group: 'active' | 'done' | 'idle'; title: string; updatedAt: number };
export const agentsKind = 'workbench-subagents';
export type Refresh = (id: SessionId) => Promise<unknown>;

export function agentCatalog(state: SessionListState, root: SessionId, statuses: SessionStatusSnapshot) {
  const rows: Row[] = [];
  const pending: SessionId[] = [];
  const failed: SessionId[] = [];
  const visited = new Set([root]);
  const parents = [root];
  for (const parent of parents) {
    const projection = state.projectionsBySession[parent];
    if (projection?.state === 'error' || projection?.state === 'migration-required') failed.push(parent);
    else if (!projection || (projection.state === 'idle' && !projection.values.subagentCatalog)) pending.push(parent);
    for (const entry of projection?.values.subagentCatalog ?? []) {
      if (visited.has(entry.id)) continue;
      visited.add(entry.id);
      const child = state.byId[entry.id];
      const timing = state.projectionsBySession[entry.id]?.values.subagentTiming ?? child?.projectionValues?.subagentTiming;
      const running = statuses.get(entry.id)?.running ?? child?.running;
      const group = entry.mode === 'external' ? 'idle' : running ? 'active' : timing?.lastTurnCompleted ? 'done' : 'idle';
      rows.push({ ...entry, parent, group, title: entry.label || child?.title || ('name' in entry && entry.name) || entry.id,
        updatedAt: Math.max(entry.createdAt, child?.updatedAt ?? 0) });
      if (entry.mode !== 'external') parents.push(entry.id);
    }
  }
  return { rows, pending, failed };
}

export function useAgentCatalog(state: SessionListState, root: SessionId, statuses: SessionStatusSnapshot, refresh: Refresh, enabled = true) {
  const catalog = useMemo(() => enabled ? agentCatalog(state, root, statuses) : { rows: [], pending: [], failed: [] }, [state, root, statuses, enabled]);
  const requested = useRef(new Set<SessionId>());
  useEffect(() => { requested.current.clear(); }, [root, enabled]);
  useEffect(() => {
    if (!enabled) return;
    const ids = [root, ...catalog.rows.filter(row => row.mode !== 'external').map(row => row.id)];
    for (const id of ids) {
      if (requested.current.has(id)) continue;
      requested.current.add(id);
      void refresh(id).catch(() => {});
    }
  }, [root, enabled, catalog, refresh]);
  return catalog;
}

export function AgentIcon({ id }: { id: string }) {
  const hash = Array.from(id).reduce((n, char) => (n * 31 + char.charCodeAt(0)) >>> 0, 0);
  return <span aria-hidden="true" style={{ color: 'hsl(' + hash % 360 + ' 65% 64%)' }}>{['✿', '◆', '✸', '❖'][hash % 4]}</span>;
}

function ChatView({ renderSlot }: ConversationViewsProps) { return <>{renderSlot('conversation.session', { view: 'chat' })}</>; }
export function AgentRecord({ renderFactorySlot }: PropsRuntime<'workbench.agent.record'> & PropsRenderFactories) {
  return renderFactorySlot('conversation.content', { variant: 'embedded', phase: 'active', hero: false }, { slots: { views: ChatView } });
}

type TabProps = PropsRuntime<'sidebar.right.pane.tab'> & PropsLocale<'workbench'> & PropsRenderSlots<'workbench.agent.record'> & {
  refresh: Refresh; retain: (parent: SessionId, child: SessionId, mode: Exclude<Entry['mode'], 'external'>) => SessionReference;
};
function Detail({ row, back, retain, SessionProvider, renderSlot, useSessions, t }: TabProps & { row: Row; back: () => void }) {
  const [reference, setReference] = useState<SessionReference>();
  const [error, setError] = useState(false);
  const projection = useSessions(state => state.projectionsBySession[row.id]?.values);
  const model = projection?.modelSelection?.lastUsed;
  const timing = projection?.subagentTiming;
  const elapsed = timing && Math.floor((timing.settledMs + (timing.active ? Math.max(0, timing.active.through - timing.active.since) : 0)) / 1000);
  useEffect(() => {
    if (row.mode === 'external') return;
    let live = true;
    let handle: SessionReference;
    try {
      handle = retain(row.parent, row.id, row.mode);
      void handle.ready.then(() => { if (live) setReference(handle); }, () => { if (live) setError(true); });
    } catch { setError(true); return; }
    return () => { live = false; handle.release(); };
  }, [row.id, row.parent, row.mode, retain]);
  return <section className="wb-agent-detail">
    <header><button type="button" className="wb-control" aria-label={t('back')} onClick={back}>←</button>
      <AgentIcon id={row.id} /><h3 title={row.title}>{row.title}</h3>
      {model && <small title={model.model}>{[model.model, model.reasoningEffort].filter(Boolean).join(' · ')}</small>}</header>
    {elapsed !== undefined && <details><summary>{t('worked')} {Math.floor(elapsed / 60)}m {elapsed % 60}s</summary>
      <dl><dt>{t('agentCreated')}</dt><dd><time dateTime={new Date(row.createdAt).toISOString()}>{new Date(row.createdAt).toLocaleString()}</time></dd>
        {timing?.active && <><dt>{t('agentTurnStarted')}</dt>
          <dd><time dateTime={new Date(timing.active.since).toISOString()}>{new Date(timing.active.since).toLocaleString()}</time></dd></>}
      </dl></details>}
    {error && <p role="alert">{t('openFailed')}</p>}
    {!error && !reference && <p role="status">{t('loadingAgentRecord')}</p>}
    {reference && <div className="wb-agent-conversation"><SessionProvider session={reference}>{renderSlot('workbench.agent.record', {})}</SessionProvider></div>}
  </section>;
}

function relativeTime(at: number) {
  const minutes = Math.max(0, Math.floor((Date.now() - at) / 60000));
  const format = new Intl.RelativeTimeFormat(document.documentElement.lang || undefined, { numeric: 'auto', style: 'short' });
  if (minutes < 60) return format.format(-minutes, 'minute');
  if (minutes < 1440) return format.format(-Math.floor(minutes / 60), 'hour');
  return format.format(-Math.floor(minutes / 1440), 'day');
}

export function SubagentsTab(props: TabProps) {
  const { sessionId, useSessions, refresh, t } = props;
  const state = useSessions(value => value);
  const statuses = props.useSessionStatus(value => value);
  const { rows, failed, pending } = useAgentCatalog(state, sessionId, statuses, refresh);
  const [selected, select] = useState<SessionId>();
  const row = rows.find(item => item.id === selected);
  if (row) return <Detail key={row.id} {...props} row={row} back={() => select(undefined)} />;
  return <div className="wb-agent-list">
    {failed.length > 0 && <button className="wb-control" onClick={() => { for (const id of failed) void refresh(id).catch(() => {}); }}>{t('retryCatalog')}</button>}
    {(['active', 'done', 'idle'] as const).map(group => {
      const items = rows.filter(entry => entry.group === group);
      if (!items.length && group === 'idle') return null;
      return <section key={group}><h3>{t(group)} · {items.length}</h3>
        {group === 'active' && !items.length && !pending.length && !failed.length && <p>{t('noActive')}</p>}
        {items.map(entry => <button type="button" key={entry.id} onClick={() => select(entry.id)} disabled={entry.mode === 'external'}>
          <AgentIcon id={entry.id} /><span className="wb-agent-name" title={entry.title}>{entry.title}</span>
          {entry.mode === 'external' ? <small>{t('unavailableRecord')}</small> : <small>
            <time dateTime={new Date(entry.updatedAt).toISOString()} title={new Date(entry.updatedAt).toLocaleString()}>
              {relativeTime(entry.updatedAt)}
            </time>
          </small>}
        </button>)}</section>;
    })}
  </div>;
}
