import { useState } from 'react';
import { PanelMenu } from './PanelMenu.js';
import type { HostObservable, InjectFace, PropsLocale, PropsRenderFactories, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client';
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client';
import type {} from '@deepseek-ai/dsh-client-ui-session/client';
import type { PanelEntry } from '../integration/panels.js';
import type {} from '../messages.js';

interface ActivityInjected {
  selectPanel: (id: MainPanelId | null) => void;
  hooks: { panels: HostObservable<readonly PanelEntry[]> };
}
export type ActivityBarProps = PropsRuntime<'shell.overlay'> & PropsRenderFactories & PropsLocale<'workbench'> & InjectFace<ActivityInjected>;

function HomeIcon() {
  return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z" />
  </svg>;
}

export function ActivityBar({ usePanels, usePanelInfo, selectPanel, renderFactorySlot, t }: ActivityBarProps) {
  const [unpinned, setUnpinned] = useState<readonly string[]>([]);
  const panels = usePanels(snapshot => snapshot);
  const hasMore = panels.some(panel => panel.id !== 'plugins');
  const selected = usePanelInfo(info => info.activePanelId);
  return <nav className="dsh-workbench-rail" aria-label={t('navigation')} data-workbench-rail>
    <button type="button" className="dsh-workbench-button" aria-label={t('conversation')} title={t('conversation')}
      aria-current={selected === null ? 'page' : undefined} onClick={() => selectPanel(null)}><HomeIcon /></button>
    <div className="dsh-workbench-panel-buttons">
      {panels.filter(panel => !hasMore || !unpinned.includes(panel.id)).map(({ id, label }) => <button key={id} type="button" className="dsh-workbench-button"
        data-workbench-panel={id} aria-label={label} title={label} aria-current={selected === id ? 'page' : undefined}
        onClick={() => selectPanel(id)}>{renderFactorySlot('sidebar.panel.icon', { id, size: 19, active: selected === id }, {
          fallback: <span aria-hidden="true">◇</span>,
        })}</button>)}
      {hasMore && <PanelMenu panels={panels} selected={selected} unpinned={unpinned} selectPanel={selectPanel}
        setUnpinned={(id, pinned) => setUnpinned(current => pinned ? current.filter(entry => entry !== id) : [...new Set([...current, id])])}
        t={t} />}
    </div>
    <div className="dsh-workbench-rail-foot">
      <span className="dsh-workbench-monogram" aria-hidden="true">DSH</span>
    </div>
  </nav>;
}
