import type { ModelPickerConnectionCard } from '@deepseek-ai/dsh-client-ui-slots';
import { useId } from 'react';
import { ManagementIcon } from './icons.js';
import codexIcon from './icons/codex.png';
import qoderIcon from './icons/qoder.png';

const appIcons: Readonly<Record<string, string>> = { codex: codexIcon, qoder: qoderIcon };

export function ConnectionCard({ id, name, status, tone, description, footer, action, details, open, toggle }:
ModelPickerConnectionCard & { open: boolean; toggle: () => void }) {
  const panelId = useId();
  const icon = Object.hasOwn(appIcons, id) ? appIcons[id] : undefined;

  return <>
    <section className="dsh-connection-card" aria-label={name}>
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
        <button type="button" data-emphasis={tone === 'warning' ? 'true' : undefined}
          aria-controls={panelId} aria-expanded={open} onClick={toggle}>
          {action}<ManagementIcon name="chevron" />
        </button>
      </footer>
    </section>
    <div className="dsh-connection-details" id={panelId} hidden={!open}>{details}</div>
  </>;
}
