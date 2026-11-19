import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { HostObservable, InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';
import type { SessionSources } from './sessionSources.js';

type PickerProps = PropsLocale<'workbench'> & InjectFace<{
  select: (source: SessionSources['selected']) => void;
  hooks: { sources: HostObservable<SessionSources> };
}>;

export function SourcePicker({ t, useSources, select }: PickerProps) {
  const { selected, codex } = useSources(current => current);
  const [row, setRow] = useState<Element | null>(null);
  const connected = Boolean(row && codex);
  return <>
    <span data-workbench-brand data-source-picker={connected || undefined}
      ref={node => { if (node) setRow(node.closest('[data-window-drag]')); }}>DSH</span>
    {row && connected && createPortal(<div className="wb-source-picker">
      <select aria-label={t('sessionSource')} value={selected}
        onChange={event => select(event.currentTarget.value === 'codex' ? 'codex' : 'dsh')}>
        <option value="dsh">DSH</option>
        <option value="codex">Codex</option>
      </select>
    </div>, row)}
  </>;
}
