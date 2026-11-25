import type { ModelPickerConnectionCard, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { ManagementIcon } from './icons.js';
import codexIcon from './icons/codex.png';
import deepseekIcon from './icons/deepseek.svg';
import grokIcon from './icons/grok.png';
import qoderIcon from './icons/qoder.png';

const providerLogos = new Map([
  ['codex', codexIcon], ['deepseek', deepseekIcon], ['grok', grokIcon], ['qoder', qoderIcon],
]);

export function ProviderIcon({ id }: { id: string }) {
  const logo = providerLogos.get(id);
  return logo ? <img className="dsh-connection-icon" src={logo} alt="" width={24} height={24} />
    : <span className="dsh-connection-icon dsh-connection-fallback">
      <ManagementIcon name="cable" size={16} />
    </span>;
}

export function ConnectionRow({ id, name, status, tone, description, footer, action, open, usage, remove, removeLabel, removeName, removeUnavailable }:
  ModelPickerConnectionCard & {
    open: () => void; usage: ReactNode; remove?: () => void; removeLabel: string; removeName: string; removeUnavailable: string;
  }) {
  const subtitle = description ?? footer;
  return <section className="dsh-connection-row" aria-label={name} data-provider={id}>
    <header><ProviderIcon id={id} /><div><h3>{name}</h3>
      {subtitle && <p className="dsh-connection-description">{subtitle}</p>}
    </div></header>
    {usage}
    <p className="dsh-connection-status" data-tone={tone} role="status">
      {tone !== 'neutral' && <ManagementIcon name={tone === 'ready' ? 'check' : 'alert'} />}{status}
    </p>
    <div className="dsh-connection-row-actions">
      <button type="button" className="dsh-connection-open" aria-label={action} onClick={open}>
        <ManagementIcon name="next" size={14} />
      </button>
      <button type="button" className="dsh-connection-remove" aria-label={removeName} aria-disabled={!remove}
        title={!remove ? removeUnavailable : undefined} onClick={remove}>{removeLabel}</button>
    </div>
  </section>;
}

export function RemoveProviderDialog({ card, t, close, refresh }: PropsLocale<'modelPicker'> & {
  card: ModelPickerConnectionCard;
  close: (removed: boolean) => void;
  refresh: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const title = useId();
  const description = useId();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    dialog.current?.showModal();
    cancel.current?.focus();
  }, []);

  async function remove() {
    if (pending || !card.removeConnection) return;
    setPending(true);
    setFailed(false);
    const removed = await card.removeConnection().catch(() => false);
    refresh();
    if (removed) {
      dialog.current?.close();
      close(true);
    } else {
      setPending(false);
      setFailed(true);
    }
  }

  return <dialog ref={dialog} className="dsh-provider-remove-dialog" aria-labelledby={title} aria-describedby={description}
    onCancel={event => {
      event.preventDefault();
      if (!pending) {
        dialog.current?.close();
        close(false);
      }
    }}>
    <h2 id={title}>{t('removeProvider', { name: card.name })}</h2>
    <p id={description}>{t(card.hasExternalConnection ? 'removeManagedConfirm' : 'removeProviderConfirm')}</p>
    {failed && <p role="alert">{t('removeProviderFailed')}</p>}
    <footer>
      <button type="button" ref={cancel} disabled={pending} onClick={() => { dialog.current?.close(); close(false); }}>{t('cancel')}</button>
      <button type="button" disabled={pending || !card.removeConnection}
        className="dsh-connection-remove" onClick={() => void remove()}>{t(pending ? 'removing' : 'remove')}</button>
    </footer>
  </dialog>;
}
