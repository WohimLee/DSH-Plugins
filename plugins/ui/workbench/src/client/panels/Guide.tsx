import { useEffect, useRef, useState } from 'react';
import { changesKind, localChangesAddress } from './changes.js';
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client';
import type { SidebarRightGuideBox } from '@deepseek-ai/dsh-client-ui-sidebar-right/client';
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';

type Search = ClientRemote['workspaceFiles']['search'];
type Result = Awaited<ReturnType<Search>>;
type GuideProps = PropsRuntime<'sidebar.right.tab.guide'> & PropsLocale<'workbench'> & InjectFace<{
  search: Search;
  hooks: { guideEntries: HostObservable<readonly SidebarRightGuideBox[]>; tabKinds: HostObservable<readonly string[]> };
}>;

const launchers = [
  { kind: 'terminal', label: 'terminal', glyph: '›_' },
  { kind: 'browser', label: 'newPage', glyph: '□' },
  { kind: changesKind, label: 'changes', glyph: '±' },
  { kind: 'files', label: 'files', glyph: '▤' },
] as const;
const knownKinds = new Set<string>(launchers.map(({ kind }) => kind));

export function Guide({ useTabInfo, useGuideEntries, useTabKinds, useSessionAccess, sessionId, search, t }: GuideProps) {
  const { tab } = useTabInfo();
  const kinds = useTabKinds(value => value);
  const entries = useGuideEntries(value => value);
  const canSearch = useSessionAccess(sessionId, 'workspaceFiles/search');
  const canOpenFile = useSessionAccess(sessionId, 'workspaceFiles/read');
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<Result>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<'openFailed' | 'searchFailed'>();
  const request = useRef<AbortController>();
  useEffect(() => () => request.current?.abort(), []);

  const launch = (kind: string, url?: string) => {
    try {
      if (url) tab.actions.openTab('browser', { params: { url }, replaceTab: true });
      else if (kind === changesKind) tab.actions.openResource(localChangesAddress(sessionId), { replaceTab: true });
      else tab.actions.openTab(kind, { replaceTab: true });
      tab.actions.close();
    } catch { setError('openFailed'); }
  };

  const submit = async () => {
    const value = query.trim();
    if (!value) return;
    setError(undefined);
    setResult(undefined);
    request.current?.abort();
    setPending(false);
    if (/^https?:\/\//iu.test(value)) {
      try {
        const url = new URL(value);
        if (!kinds.includes('browser') || url.username || url.password) throw new Error();
        launch('browser', url.href);
      } catch { setError('openFailed'); }
      return;
    }
    if (!canSearch) { setError('searchFailed'); return; }
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    try {
      const response = await search(sessionId, { query: value, excludedPaths: [], includeHidden: false, respectGitignore: true }, controller.signal);
      if (!controller.signal.aborted) setResult(response);
    } catch {
      if (!controller.signal.aborted) setError('searchFailed');
    } finally {
      if (!controller.signal.aborted) setPending(false);
    }
  };

  const openFile = (path: string) => {
    try {
      const address = ['dsh-resource://file/session', encodeURIComponent(sessionId), ...path.split('/').map(encodeURIComponent)].join('/');
      tab.actions.openResource(address, { replaceTab: true });
      tab.actions.close();
    } catch { setError('openFailed'); }
  };
  const files = result?.ok ? result.value.matches.filter(entry => entry.type === 'file') : undefined;
  return <section className="wb-guide" aria-label={t('newTab')} data-workbench-guide>
    <form onSubmit={event => { event.preventDefault(); void submit(); }}>
      <input type="search" aria-label={t('findOrOpen')} placeholder={t('findOrOpen')} value={query}
        onChange={event => {
          request.current?.abort();
          setPending(false);
          setResult(undefined);
          setError(undefined);
          setQuery(event.target.value);
        }} />
      <button className="wb-control" type="submit" disabled={!query.trim()}>{t('go')}</button>
    </form>
    {pending && <p role="status">{t('searching')}</p>}
    {(error || result?.ok === false) && <p role="status">{t(error ?? 'searchFailed')}</p>}
    {files && <div className="wb-guide-results">
      {files.length === 0 && <p role="status">{t('noFiles')}</p>}
      {files.slice(0, 12).map(({ path }) => <button type="button" className="wb-control" key={path} title={path}
        disabled={!canOpenFile} onClick={() => openFile(path)}>{path}</button>)}
      {result?.ok && (result.value.incomplete || result.value.truncated || files.length > 12)
        && <p role="status">{t('partialFiles')}</p>}
    </div>}
    <div className="wb-guide-grid">
      {launchers.map(({ kind, label, glyph }) => <button type="button" className="wb-control" key={kind}
        disabled={!kinds.includes(kind)} title={!kinds.includes(kind) ? t('providerMissing') : undefined}
        onClick={() => launch(kind)}><span aria-hidden="true">{glyph}</span>{t(label)}</button>)}
      {entries.filter(entry => !knownKinds.has(entry.kind)).map(entry => <button type="button" className="wb-control"
        key={JSON.stringify([entry.providerId, entry.id])} title={entry.description?.()} onClick={() => launch(entry.kind)}>
        {entry.icon && <entry.icon size={18} />}{entry.title()}
      </button>)}
    </div>
  </section>;
}
