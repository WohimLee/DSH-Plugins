import { useLayoutEffect, useRef, useState } from 'react';
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';
import type { WorkspaceCommands } from './commands.js';
import { DirectoryDialog } from './DirectoryDialog.js';
import { Glyph } from './Glyph.js';

export function EditProjectDialog({ initial, folders, root, commands, canPickDirectory, close, save, remove, t }: PropsLocale<'workbench'> & {
  initial: string; folders: readonly string[]; root: string; commands: WorkspaceCommands; canPickDirectory: boolean;
  close: () => void; save: (name: string, folders: string[]) => Promise<void>; remove: () => Promise<void>;
}) {
  const modal = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(initial);
  const [paths, setPaths] = useState([...folders]);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  useLayoutEffect(() => {
    const dialog = modal.current!;
    dialog.showModal();
    input.current?.focus();
    return () => dialog.close();
  }, []);
  const commit = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(false);
    try { await action(); close(); }
    catch { setError(true); setBusy(false); }
  };
  const addPath = (path: string) => setPaths(current => current.includes(path) ? current : [...current, path]);
  const addFolder = async () => {
    if (!commands.desktopPicker) {
      setPicking(true);
      return;
    }
    setBusy(true);
    setError(false);
    try {
      const selected = await commands.desktopPicker.pick();
      if (selected) addPath(selected);
    } catch { setError(true); }
    finally { setBusy(false); }
  };
  return <>
    <dialog ref={modal} className="wb-edit-project" aria-label={t('editProject')}
      onCancel={event => { event.preventDefault(); if (!busy) close(); }}
      onClick={event => { if (!busy && event.target === modal.current) close(); }}>
      <form onSubmit={event => { event.preventDefault(); if (name.trim()) void commit(() => save(name.trim(), paths)); }}>
        <header><strong>{t('editProject')}</strong><button type="button" disabled={busy} aria-label={t('close')} onClick={close}>×</button></header>
        <label className="wb-project-name"><Glyph icon="project" /><input ref={input} aria-label={t('projectName')} disabled={busy}
          value={name} onChange={event => setName(event.target.value)} /></label>
        <div>{t('sourceFolders')}</div>
        <div className="wb-folder-list">
          {paths.map(path => <div key={path} className="wb-folder-row"><Glyph icon="project" /><span>{path.split(/[\\/]/).filter(Boolean).at(-1) || path}</span>
            <span className="wb-folder-tooltip" role="tooltip">{path}</span>
            <button type="button" aria-label={t('removeFolder') + ' ' + path} disabled={busy}
              onClick={() => setPaths(paths.filter(item => item !== path))}>×</button></div>)}
          <button type="button" disabled={busy || (!!commands.desktopPicker && !canPickDirectory)} onClick={() => void addFolder()}><Glyph icon="folderAdd" />{t('addFolder')}</button>
        </div>
        {error && <div role="alert">{t('actionFailed')}</div>}
        <footer><button className="wb-remove-local" type="button" disabled={busy}
          onClick={() => { if (window.confirm(t('removeProjectConfirm'))) void commit(remove); }}>{t('removeLocal')}</button>
          <button type="button" disabled={busy} onClick={close}>{t('cancel')}</button>
          <button className="wb-save-project" disabled={!name.trim() || busy}>{t('save')}</button></footer>
      </form>
    </dialog>
    {picking && <DirectoryDialog initial={root} list={commands.listDirectory} pick={commands.pickDirectory} t={t}
      cancel={() => setPicking(false)} confirm={async path => {
        addPath(path);
        setPicking(false);
      }} />}
  </>;
}
