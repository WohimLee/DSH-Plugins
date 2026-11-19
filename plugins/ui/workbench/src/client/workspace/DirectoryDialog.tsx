import { useEffect, useRef, useState } from 'react';
import type { WorkspaceCommands } from './commands.js';
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';

type ListDirectory = WorkspaceCommands['listDirectory'];

export function DirectoryDialog({ initial, list, pick, cancel, confirm, t }: PropsLocale<'workbench'> & {
  initial?: string;
  list: ListDirectory;
  pick: () => Promise<string | null>;
  cancel: () => void;
  confirm: (path: string) => Promise<void>;
}) {
  const modal = useRef<HTMLDialogElement>(null);
  const [location, setLocation] = useState(initial);
  const [result, setResult] = useState<Awaited<ReturnType<ListDirectory>>>();
  const browse = (next: string) => { setPath(next); setLocation(next); };
  const [path, setPath] = useState(initial ?? '');
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => { modal.current?.showModal(); }, []);
  useEffect(() => {
    const request = new AbortController();
    setError(false);
    setResult(undefined);
    void list(location, request.signal).then(value => {
      if (request.signal.aborted) return;
      setResult(value);
      if (value.listing) setPath(current => current === location || current === '' ? value.listing.path : current);
    }, () => { if (!request.signal.aborted) setError(true); });
    return () => request.abort();
  }, [list, location]);

  return <dialog ref={modal} className="wb-directory" aria-label={t('chooseDirectory')}
    onCancel={event => { event.preventDefault(); if (!busy) cancel(); }}>
    <form onSubmit={event => {
      event.preventDefault();
      if (busy || !path.trim()) return;
      setBusy(true);
      setError(false);
      void confirm(path.trim()).catch(() => { setError(true); setBusy(false); });
    }}>
      <strong>{t('chooseDirectory')}</strong>
      <label>{t('directoryPath')}<input value={path} onChange={event => setPath(event.target.value)} disabled={busy} /></label>
      <div className="wb-directory-bar">
        {!result?.native && <button type="button" className="wb-control" disabled={busy || !path.trim()}
          onClick={() => browse(path.trim())}>{t('browse')}</button>}
        {result?.native && <button type="button" className="wb-control" disabled={busy} onClick={() => {
          setBusy(true);
          void pick().then(selected => { if (selected) setPath(selected); }, () => setError(true))
            .finally(() => setBusy(false));
        }}>{t('systemPicker')}</button>}
      </div>
      {result?.listing && <div className="wb-directory-entries">
        {result.listing.crumbs.length > 1 && <button type="button" className="wb-control" disabled={busy}
          onClick={() => { const parent = result.listing?.crumbs.at(-2)?.path; if (parent) browse(parent); }}>↑ {t('parentDirectory')}</button>}
        {result.listing.entries.map(entry => <button type="button" className="wb-control" key={entry.path} disabled={busy}
          onClick={() => browse(entry.path)}>{entry.name}</button>)}
      </div>}
      {error && <div role="alert">{t('directoryFailed')}</div>}
      <div className="wb-directory-bar">
        <button type="button" className="wb-control" disabled={busy} onClick={cancel}>{t('cancel')}</button>
        <button type="submit" className="wb-control" disabled={!path.trim() || busy}>{t('useDirectory')}</button>
      </div>
    </form>
  </dialog>;
}
