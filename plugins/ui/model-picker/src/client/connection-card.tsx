import type { ModelPickerConnectionCard } from '@deepseek-ai/dsh-client-ui-slots';
import type { ReactNode } from 'react';
import { ManagementIcon, ProviderGlyph } from './icons.js';
import grokIcon from './icons/grok.png';

export function ProviderIcon({ id }: { id: string }) {
  return id === 'grok' ? <img className="dsh-connection-icon" src={grokIcon} alt="" width="34" height="34" />
    : <span className="dsh-connection-icon dsh-connection-fallback" data-provider={id}>
      <ProviderGlyph id={id} size={18} />
    </span>;
}

export function ConnectionCard({ id, name, status, tone, description, footer, action, usage, open }:
  ModelPickerConnectionCard & { usage: ReactNode; open: () => void }) {
  return <section className="dsh-connection-card" aria-label={name}>
    <header><ProviderIcon id={id} /><h3>{name}</h3></header>
    <p className="dsh-connection-status" data-tone={tone} role="status">
      {tone !== 'neutral' && <ManagementIcon name={tone === 'ready' ? 'check' : 'alert'} />}{status}
    </p>
    {description && <p className="dsh-connection-description">{description}</p>}
    <footer>
      <span className="dsh-connection-footer-label">
        {footer && <><ManagementIcon name={id === 'codex' || id === 'deepseek' ? 'layers' : 'key'} />{footer}</>}
      </span>
      <div className="dsh-connection-actions">
        {usage}
        <button type="button" className="dsh-connection-open" onClick={open}>
          {action}<ManagementIcon name="next" size={13} />
        </button>
      </div>
    </footer>
  </section>;
}
