import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export type MenuEntry = { label: string; run?: () => void; children?: readonly MenuEntry[]; danger?: boolean };
export interface MenuTarget { x: number; y: number; restore: HTMLElement; label: string; entries: readonly MenuEntry[] }

export function RowMenu({ target, close, unavailable, back }: { target: MenuTarget; close: () => void; unavailable: string; back: string }) {
  const menu = useRef<HTMLDivElement>(null);
  const [levels, setLevels] = useState<readonly MenuEntry[][]>([]);
  const entries = levels.at(-1) ?? target.entries;

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !menu.current?.contains(event.target)) close();
    };
    window.addEventListener('pointerdown', closeOutside, true);
    window.addEventListener('resize', close);
    return () => { window.removeEventListener('pointerdown', closeOutside, true); window.removeEventListener('resize', close); };
  }, [close]);

  useLayoutEffect(() => {
    const element = menu.current;
    if (!element) return;
    const zoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
    const { width, height } = element.getBoundingClientRect();
    element.style.left = Math.max(4, Math.min(target.x, window.innerWidth - width - 8)) / zoom + 'px';
    element.style.top = Math.max(4, Math.min(target.y, window.innerHeight - height - 8)) / zoom + 'px';
    const first = element.querySelector<HTMLElement>('button:not(:disabled)');
    (first ?? element).focus();
  }, [entries, target]);

  return createPortal(<div ref={menu} className="wb-row-menu" role="menu" aria-label={target.label} tabIndex={-1}
    onContextMenu={event => event.preventDefault()}
    onKeyDown={event => {
      if (event.key === 'Escape' || (event.key === 'ArrowLeft' && levels.length)) {
        event.preventDefault();
        event.stopPropagation();
        if (levels.length) setLevels(levels.slice(0, -1));
        else { close(); target.restore.focus(); }
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled)'));
        const index = buttons.indexOf(document.activeElement as HTMLElement);
        buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
      } else if (event.key === 'ArrowRight' && document.activeElement instanceof HTMLButtonElement &&
        document.activeElement.getAttribute('aria-haspopup') === 'menu') {
        event.preventDefault();
        document.activeElement.click();
      } else if (event.key === 'Tab') {
        close();
        target.restore.focus();
      }
    }}>
    {levels.length > 0 && <button type="button" role="menuitem" aria-label={back} onClick={() => setLevels(levels.slice(0, -1))}>←</button>}
    {entries.map(entry => <button key={entry.label} type="button" role="menuitem" disabled={!entry.run && !entry.children?.length}
      aria-haspopup={entry.children?.length ? 'menu' : undefined} title={!entry.run && !entry.children?.length ? unavailable : undefined}
      data-danger={entry.danger || undefined} onClick={() => {
        if (entry.children?.length) setLevels([...levels, [...entry.children]]);
        else if (entry.run) { close(); target.restore.focus(); entry.run(); }
      }}>
      <span>{entry.label}</span>{entry.children?.length ? <span aria-hidden="true">›</span> : null}
    </button>)}
  </div>, document.body);
}
