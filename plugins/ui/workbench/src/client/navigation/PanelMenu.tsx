import { useRef, useState } from 'react';
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client';
import type { PanelEntry } from '../integration/panels.js';

export function PanelMenu({ panels, selected, unpinned, setUnpinned, selectPanel, t }: {
  panels: readonly PanelEntry[];
  selected: MainPanelId | null;
  unpinned: readonly string[];
  setUnpinned: (id: string, pinned: boolean) => void;
  selectPanel: (id: MainPanelId) => void;
} & PropsLocale<'workbench'>) {
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const onDismiss = () => { setOpen(false); button.current?.focus(); };
  return <div className="wb-panel-menu" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }} onKeyDown={event => {
    if (event.key !== 'Escape' || !open) return;
    event.stopPropagation();
    onDismiss();
  }}>
    <button type="button" className="dsh-workbench-button" ref={button} title={t('morePanels')}
      aria-label={t('morePanels')} aria-expanded={open} onClick={() => setOpen(!open)}>
      <span aria-hidden="true">•••</span>
    </button>
    {open && <div className="wb-panel-popup">
      {panels.filter(panel => panel.id !== 'plugins').map(({ id, label }) => {
        const pinned = !unpinned.includes(id);
        return <div className="wb-panel-menu-row" key={id}>
          <button type="button" className="wb-control" aria-current={id === selected ? 'page' : undefined}
            onClick={() => { selectPanel(id); onDismiss(); }}>{label}</button>
          <button type="button" className="wb-control" aria-pressed={pinned} title={t('pinLauncher')}
            aria-label={t('pinLauncher') + ' · ' + label} onClick={() => setUnpinned(id, !pinned)}>
            <span aria-hidden="true">{pinned ? '●' : '○'}</span>
          </button>
        </div>;
      })}
    </div>}
  </div>;
}
