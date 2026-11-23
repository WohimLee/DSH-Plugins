import { useLayoutEffect, useRef, useState } from 'react';
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';
import type { WorkspaceCommands } from './commands.js';
import { DirectoryDialog } from './DirectoryDialog.js';
import { Glyph } from './Glyph.js';

type ProjectDialogProps = PropsLocale<'workbench'> & {
  root?: string; commands: WorkspaceCommands; canPickDirectory: boolean;
  close: () => void;
} & ({ mode: 'create'; save: (name: string, folders: [string, ...string[]]) => Promise<'projectNameTaken' | 'projectFolderTaken' | undefined> }
  | { mode: 'edit'; initial: string; folders: readonly string[]; remove: () => void; save: (name: string, folders: string[]) => Promise<void> });

export function ProjectDialog(props: ProjectDialogProps) {
  const { root, commands, canPickDirectory, close, t } = props;
  const creating = props.mode === 'create';
  const title = t(creating ? 'createProject' : 'editProject');
  const modal = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const backdropPress = useRef(false);
  const [name, setName] = useState(creating ? '' : props.initial);
  const [paths, setPaths] = useState(creating ? [] : [...props.folders]);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<'actionFailed' | 'projectNameTaken' | 'projectFolderTaken'>();
  useLayoutEffect(() => {
    const dialog = modal.current!;
    dialog.showModal();
    input.current?.focus();
    return () => dialog.close();
  }, []);
  const commit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(undefined);
    try {
      const title = name.trim();
      const result = props.mode === 'create'
        ? await props.save(title, [paths[0]!, ...paths.slice(1)])
        : await props.save(title, paths);
      if (!result) { close(); return; }
      setError(result);
    } catch { setError('actionFailed'); }
    setBusy(false);
  };
  const addPath = (path: string) => setPaths(current => current.includes(path) ? current : [...current, path]);
  const addFolder = async () => {
    if (!commands.desktopPicker) {
      setPicking(true);
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const selected = await commands.desktopPicker.pick();
      if (selected) addPath(selected);
    } catch { setError('actionFailed'); }
    finally { setBusy(false); }
  };
  const canSubmit = !!name.trim() && (!creating || paths.length > 0) && !busy;
  const add = <button type="button" disabled={busy || (!!commands.desktopPicker && !canPickDirectory)}
    onClick={() => void addFolder()}><Glyph icon="folderAdd" />{t(creating && !paths.length ? 'add' : 'addFolder')}</button>;
  return <>
    <dialog ref={modal} className={creating ? 'wb-edit-project wb-create-project' : 'wb-edit-project'} aria-label={title}
      onCancel={event => { event.preventDefault(); if (!busy) close(); }}
      onPointerDown={event => { backdropPress.current = event.target === modal.current; }}
      onClick={event => {
        if (!busy && backdropPress.current && event.target === modal.current) close();
        backdropPress.current = false;
      }}>
      <form onSubmit={event => { event.preventDefault(); void commit(); }}>
        <header><strong>{title}</strong><button type="button" disabled={busy} aria-label={t('close')} onClick={close}>×</button></header>
        <label className="wb-project-name"><Glyph icon="project" /><input ref={input} aria-label={t('projectName')} disabled={busy}
          placeholder={creating ? t('projectName') : undefined} value={name}
          onChange={event => { setName(event.target.value); setError(undefined); }} /></label>
        <div className="wb-project-sources">{t('sourceFolders')}</div>
        {creating && !paths.length ? <div className="wb-folder-empty">
          <span>{t(commands.desktopPicker ? 'addLocalFolder' : 'addSourceFolder')}</span>{add}
        </div> : <div className="wb-folder-list">
          {paths.map((path, index) => <div key={path} className="wb-folder-row"><Glyph icon="project" /><span>{path.split(/[\\/]/).filter(Boolean).at(-1) || path}</span>
            {creating && index === 0 && <small>{t('workingFolder')}</small>}
            <span className="wb-folder-tooltip" role="tooltip">{path}</span>
            <button type="button" aria-label={t('removeFolder') + ' ' + path} disabled={busy}
              onClick={() => { setPaths(paths.filter(item => item !== path)); setError(undefined); }}>×</button></div>)}
          {add}
        </div>}
        {error && <div role="alert">{t(error)}</div>}
        <footer>{props.mode === 'edit' && <button className="wb-remove-local" type="button" disabled={busy}
          onClick={props.remove}>{t('removeLocal')}</button>}
          <button type="button" disabled={busy} onClick={close}>{t('cancel')}</button>
          <button className="wb-save-project" disabled={!canSubmit}>{t(creating ? 'createProject' : 'save')}</button></footer>
      </form>
    </dialog>
    {picking && <DirectoryDialog initial={root} list={commands.listDirectory} pick={commands.pickDirectory} t={t} requireExisting={creating}
      cancel={() => setPicking(false)} confirm={async path => {
        addPath(path);
        setPicking(false);
      }} />}
  </>;
}
