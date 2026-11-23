import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';

type RemovalIssue = 'removeBusy' | 'removeReady' | 'removeFailed' | 'removeChanged';

export function RemoveProjectDialog({ name, project, count, blocked, close, remove, t }: PropsLocale<'workbench'> & {
  name: string;
  project: boolean;
  count: number;
  blocked?: RemovalIssue;
  close: () => void;
  remove: () => Promise<RemovalIssue | undefined>;
}) {
  const modal = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<RemovalIssue>();
  useLayoutEffect(() => {
    const dialog = modal.current;
    if (!dialog) return;
    dialog.showModal();
    cancel.current?.focus();
    return () => dialog.close();
  }, []);
  const label = t(project ? 'removeProject' : 'removeUngrouped');
  const issue = blocked ?? error;
  return <dialog ref={modal} className="wb-edit-project wb-remove-project" aria-labelledby={titleId} aria-describedby={descriptionId}
    onCancel={event => { event.preventDefault(); if (!busy) close(); }}>
    <form onSubmit={async event => {
      event.preventDefault();
      if (blocked || busy) return;
      setBusy(true);
      setError(undefined);
      try {
        const result = await remove();
        if (result) setError(result);
        else close();
      } catch { setError('removeFailed'); }
      finally { setBusy(false); }
    }}>
      <header><strong id={titleId}>{label} · {name}</strong></header>
      <div id={descriptionId}>
        <p>{t('removeCount')} <b>{count}</b></p>
        {count > 0 && <p>{t('removeHistory')}</p>}
        <p>{t(project ? 'removeProjectScope' : 'removeUngroupedScope')}</p>
        {count > 0 && <p>{t('removeDeferred')}</p>}
      </div>
      {issue && <div role="alert">{t(issue)}</div>}
      <footer>
        <button type="button" ref={cancel} disabled={busy} onClick={close}>{t('cancel')}</button>
        <button className="wb-remove-local" disabled={!!blocked || busy}>{label}</button>
      </footer>
    </form>
  </dialog>;
}
