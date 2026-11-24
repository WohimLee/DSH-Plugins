import type { ModelPickerConnectionCard } from '@deepseek-ai/dsh-client-ui-slots';
import { ManagementIcon, ProviderGlyph } from './icons.js';
import grokIcon from './icons/grok.png';

export function ProviderIcon({ id }: { id: string }) {
  return id === 'grok' ? <img className="dsh-connection-icon" src={grokIcon} alt="" width="34" height="34" />
    : <span className="dsh-connection-icon dsh-connection-fallback" data-provider={id}>
      <ProviderGlyph id={id} size={18} />
    </span>;
}

export function ConnectionRow({ id, name, status, tone, description, footer, action, open }:
  ModelPickerConnectionCard & { open: () => void }) {
  const subtitle = description ?? footer;
  return <section className="dsh-connection-row" aria-label={name} data-provider={id}>
    <header><ProviderIcon id={id} /><div><h3>{name}</h3>
      {subtitle && <p className="dsh-connection-description">{subtitle}</p>}
    </div></header>
    <p className="dsh-connection-status" data-tone={tone} role="status">
      {tone !== 'neutral' && <ManagementIcon name={tone === 'ready' ? 'check' : 'alert'} />}{status}
    </p>
    <button type="button" className="dsh-connection-open" aria-label={action} onClick={open}>
      <ManagementIcon name="next" size={14} />
    </button>
  </section>;
}
