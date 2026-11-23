import type { ModelPickerConnectionCard } from '@deepseek-ai/dsh-client-ui-slots';
import { type ReactNode, useId, useRef } from 'react';
import { ManagementIcon } from './icons.js';
import codexIcon from './icons/codex.png';
import grokIcon from './icons/grok.png';
import qoderIcon from './icons/qoder.png';

const appIcons: Readonly<Record<string, string>> = { codex: codexIcon, grok: grokIcon, qoder: qoderIcon };

export function ConnectionCard({ id, name, status, tone, description, footer, action, details, usage, closeLabel }:
ModelPickerConnectionCard & { usage: ReactNode; closeLabel: string }) {
  const panelId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const icon = Object.hasOwn(appIcons, id) ? appIcons[id] : undefined;

  return <section className="dsh-connection-card" aria-label={name}>
      <header>
        {icon ? <img className="dsh-connection-icon" src={icon} alt="" width="42" height="42" />
          : <span className="dsh-connection-icon dsh-connection-fallback"><ManagementIcon name="cable" size={22} /></span>}
        <h3>{name}</h3>
      </header>
      <p className="dsh-connection-status" data-tone={tone} role="status">
        {tone !== 'neutral' && <ManagementIcon name={tone === 'ready' ? 'check' : 'alert'} />}{status}
      </p>
      {description && <p className="dsh-connection-description">{description}</p>}
      <footer>
        <span className="dsh-connection-footer-label">
          {footer && <><ManagementIcon name={id === 'codex' ? 'layers' : 'key'} />{footer}</>}
        </span>
        <div className="dsh-connection-actions">
          {usage}
          <button type="button" className="dsh-connection-open" data-emphasis={tone === 'warning' ? 'true' : undefined}
            aria-controls={panelId} aria-haspopup="dialog" onClick={() => dialog.current?.showModal()}>
            {action}<span aria-hidden="true">›</span>
          </button>
        </div>
      </footer>
      <dialog className="dsh-connection-details" id={panelId} aria-label={name} ref={dialog}>
        <button type="button" className="dsh-connection-close" aria-label={closeLabel}
          onClick={() => dialog.current?.close()}><span aria-hidden="true">×</span></button>
        {details}
      </dialog>
    </section>;
}
