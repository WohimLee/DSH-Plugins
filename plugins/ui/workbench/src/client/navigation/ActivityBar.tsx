import { useLayoutEffect, useRef, useState } from 'react';
import { PanelMenu } from './PanelMenu.js';
import { PluginsNavigation } from './PluginsNavigation.js';
import { ScheduledNavigation } from './ScheduledNavigation.js';
import type { NativeScheduleText } from './scheduled-native.js';
import type { ScheduledTasks } from './scheduled-source.js';
import type { HostObservable, InjectFace, PropsLocale, PropsRenderFactories, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client';
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client';
import type {} from '@deepseek-ai/dsh-client-ui-session/client';
import type { PanelEntry } from '../integration/panels.js';
import type {} from '../messages.js';

interface ActivityInjected {
  selectPanel: (id: MainPanelId | null) => void;
  openPluginsList: () => boolean;
  nativeScheduleText: NativeScheduleText;
  hooks: { panels: HostObservable<readonly PanelEntry[]>; scheduledTasks: HostObservable<ScheduledTasks> };
}
export type ActivityBarProps = PropsRuntime<'shell.overlay'> & PropsRenderFactories & PropsLocale<'workbench'> & InjectFace<ActivityInjected>;

function HomeIcon() {
  return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z" />
  </svg>;
}

export function ActivityBar({ usePanels, usePanelInfo, selectPanel, openPluginsList, renderFactorySlot, t,
  useScheduledTasks, nativeScheduleText }: ActivityBarProps) {
  const rail = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const frame = rail.current?.closest<HTMLElement>('[data-slot="root"] > div');
    if (!frame) return;
    const property = '--wb-host-sidebar-track';
    const syncWidth = () => {
      // AppFrame writes the live track before painting, including during a drag.
      const track = frame.style.gridTemplateColumns.match(/^\d+(?:\.\d+)?px(?= )/)?.[0];
      const expanded = !frame.hasAttribute('data-sidebar-collapsed') && !frame.hasAttribute('data-sidebar-drawer');
      const width = expanded ? track : undefined;
      if (frame.style.getPropertyValue(property) === (width ?? '')) return;
      if (width) frame.style.setProperty(property, width);
      else frame.style.removeProperty(property);
    };
    syncWidth();
    const observer = new MutationObserver(syncWidth);
    observer.observe(frame, { attributes: true, attributeFilter: ['style', 'data-sidebar-collapsed', 'data-sidebar-drawer'] });
    return () => {
      observer.disconnect();
      frame.style.removeProperty(property);
    };
  }, []);
  const [unpinned, setUnpinned] = useState<readonly string[]>([]);
  const panels = usePanels(snapshot => snapshot);
  const hasMore = panels.some(panel => panel.id !== 'plugins');
  const selected = usePanelInfo(info => info.activePanelId);
  const plugins = selected === 'plugins' && panels.find(panel => panel.id === 'plugins');
  const scheduled = selected === 'schedules';
  return <>
    {(plugins || scheduled || selected === 'dsh-model-picker') && <div className="wb-window-caption">DSH Desktop</div>}
    <nav ref={rail} className="dsh-workbench-rail" aria-label={t('navigation')} data-workbench-rail>
      <button type="button" className="dsh-workbench-button" aria-label={t('conversation')} title={t('conversation')}
        aria-current={selected === null ? 'page' : undefined} onClick={() => selectPanel(null)}><HomeIcon /></button>
      <div className="dsh-workbench-panel-buttons">
        {panels.filter(panel => !hasMore || !unpinned.includes(panel.id)).map(({ id, label }) => <button key={id} type="button" className="dsh-workbench-button"
          data-workbench-panel={id} aria-label={label} title={label} aria-current={selected === id ? 'page' : undefined}
          onClick={() => selectPanel(id)}>{id === 'plugins' ? <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" aria-hidden="true">
            <rect x="3" y="8" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="16" width="7" height="6" rx="1" /><rect x="11" y="13" width="7" height="7" rx="1" />
          </svg> : renderFactorySlot('sidebar.panel.icon', { id, size: 19, active: selected === id }, {
            fallback: <span aria-hidden="true">◇</span>,
          })}</button>)}
        {hasMore && <PanelMenu panels={panels} selected={selected} unpinned={unpinned} selectPanel={selectPanel}
          setUnpinned={(id, pinned) => setUnpinned(current => pinned ? current.filter(entry => entry !== id) : [...new Set([...current, id])])}
          t={t} />}
      </div>
    </nav>
    {plugins && <PluginsNavigation label={plugins.label} openList={openPluginsList} t={t} />}
    {scheduled && <ScheduledNavigation {...{ t, useScheduledTasks }} nativeText={nativeScheduleText} />}
  </>;
}
