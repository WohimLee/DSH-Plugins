import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';

export function RenameSessionDialog({ initial, close, save, t }: PropsLocale<'workbench'> & {
  initial: string;
  close: () => void;
  save: (title: string) => Promise<void>;
}) {
  const heading = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const [title, setTitle] = useState(initial);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    inputRef.current?.focus();
    inputRef.current?.select();
    return () => dialog?.close();
  }, []);

  return <dialog ref={dialogRef} className="wb-rename-session" aria-labelledby={heading}
    onCancel={event => { event.preventDefault(); if (!busy.current) close(); }}>
    <form onSubmit={event => {
      event.preventDefault();
      const name = title.trim();
      if (!name || busy.current) return;
      busy.current = true;
      setSaving(true);
      setError(false);
      void save(name).then(close, () => {
        busy.current = false;
        setSaving(false);
        setError(true);
      });
    }}>
      <strong id={heading}>{t('renameSession')}</strong>
      <input ref={inputRef} aria-label={t('sessionName')} value={title} disabled={saving}
        onChange={event => { setTitle(event.target.value); setError(false); }} />
      {error && <div role="alert">{t('actionFailed')}</div>}
      <div className="wb-rename-actions">
        <button type="button" className="wb-control" disabled={saving} onClick={close}>{t('cancel')}</button>
        <button type="submit" className="wb-control" disabled={!title.trim() || saving}>{t('save')}</button>
      </div>
    </form>
  </dialog>;
}
