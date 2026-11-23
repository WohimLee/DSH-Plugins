import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Context } from '@deepseek-ai/cordis';
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client';
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';
import { Glyph } from './Glyph.js';
import type { SessionId } from './commands.js';

type Search = Context['sessions']['search'];
type Workspace = ReturnType<Context['workspaces']['list']['getSnapshot']>['items'][number];
type SearchResults = { query: string; snippets: Map<SessionId, string> };
const resultLimit = 20;

const normalize = (text: string) => text.normalize('NFKC').toLocaleLowerCase();

export function SessionSearch({ sessions, workspaces, archived, search, openSession, close, t }: PropsLocale<'workbench'> & {
  sessions: SessionListState; workspaces: readonly Workspace[]; archived: readonly SessionId[];
  search: Search; openSession: (id: SessionId) => void; close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const backdropPress = useRef(false);
  const [text, setText] = useState('');
  const [remote, setRemote] = useState<SearchResults>();
  const query = text.trim();
  useLayoutEffect(() => {
    const element = dialog.current!;
    element.showModal();
    input.current?.focus();
    return () => element.close();
  }, []);
  useEffect(() => {
    if (!query) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void search(query, controller.signal).then(result => {
        if (controller.signal.aborted) return;
        setRemote({ query, snippets: new Map(result.ok ? result.value.items.map(item => [item.sessionId, item.snippet]) : []) });
      }).catch(() => {
        if (!controller.signal.aborted) setRemote({ query, snippets: new Map() });
      });
    }, 180);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, search]);

  const content = remote?.query === query ? remote : undefined;
  const archivedIds = new Set(archived);
  const projectBySession = new Map(workspaces.flatMap(workspace => workspace.sessionIds.map(id => [id, workspace.title] as const)));
  const terms = normalize(query).split(/\s+/);
  const rows = query ? sessions.ids.flatMap(id => {
    const session = sessions.byId[id];
    if (!session || session.blank || session.origin === 'subagent' || archivedIds.has(id)) return [];
    const project = projectBySession.get(id);
    const label = session.displayTitle || session.title || id;
    const snippet = content?.snippets.get(id);
    const matches = normalize([label, project, id].filter(Boolean).join(' '));
    return terms.every(term => matches.includes(term)) || snippet !== undefined ? [{ id, label, project, snippet }] : [];
  }).slice(0, resultLimit) : [];
  const dismiss = () => { dialog.current?.close(); close(); };
  const choose = (id: SessionId) => { dismiss(); openSession(id); };

  return <dialog className="wb-session-search" ref={dialog} aria-label={t('sessionSearch')}
    onCancel={event => { event.preventDefault(); dismiss(); }}
    onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismiss(); }
    }}
    onPointerDown={event => { backdropPress.current = event.target === dialog.current; }}
    onClick={event => {
      if (backdropPress.current && event.target === dialog.current) dismiss();
      backdropPress.current = false;
    }}>
    <form onSubmit={event => { event.preventDefault(); if (rows[0]) choose(rows[0].id); }}>
      <div className="wb-search-field">
        <Glyph icon="search" />
        <input ref={input} type="search" value={text} maxLength={512} aria-label={t('sessionSearch')}
          placeholder={t('sessionSearch')} onChange={event => setText(event.target.value)} />
        <button className="wb-control" type="button" aria-label={t('close')} onClick={dismiss}><Glyph icon="close" /></button>
      </div>
      {rows.length > 0 && <ul aria-label={t('sessionSearchResults')}>
        {rows.map(row => <li key={row.id}><button type="button" onClick={() => choose(row.id)}>
          <span>{row.label}</span>
          {(row.snippet || row.project) && <small>{row.snippet || row.project}</small>}
        </button></li>)}
      </ul>}
      {query && !rows.length && <p role="status">{t(content ? 'sessionSearchEmpty' : 'sessionSearching')}</p>}
    </form>
  </dialog>;
}
