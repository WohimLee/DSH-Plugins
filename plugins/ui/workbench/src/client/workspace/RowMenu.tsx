import { Glyph, type Icon } from './Glyph.js';
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';

export type MenuEntry = {
  label: string; icon?: Icon; shortcut?: { label: string; aria: string }; divider?: boolean;
  run?: () => void; children?: readonly MenuEntry[]; danger?: boolean;
};
export interface MenuTarget { x: number; y: number; restore: HTMLElement; label: string; entries: readonly MenuEntry[] }

interface MenuAnchor { x: number; y: number; parent?: HTMLButtonElement }

function MenuPanel({ label, entries, anchor, autoFocus, unavailable, onBack, onClose }: {
  label: string; entries: readonly MenuEntry[]; anchor: MenuAnchor; autoFocus: boolean;
  unavailable: string; onBack?: () => void; onClose: () => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const [submenu, setSubmenu] = useState<{ entry: MenuEntry; parent: HTMLButtonElement; focus: boolean }>();

  useLayoutEffect(() => {
    const element = menu.current;
    if (!element) return;
    const zoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
    const { width, height } = element.getBoundingClientRect();
    const parent = anchor.parent?.getBoundingClientRect();
    const x = parent && parent.right + width > window.innerWidth - 4 ? parent.left - width : parent?.right ?? anchor.x;
    const y = parent?.top ?? anchor.y;
    element.style.left = Math.max(4, Math.min(x, window.innerWidth - width - 4)) / zoom + 'px';
    element.style.top = Math.max(4, Math.min(y, window.innerHeight - height - 4)) / zoom + 'px';
  }, [anchor, entries]);

  useLayoutEffect(() => {
    if (autoFocus) (menu.current?.querySelector<HTMLElement>('button:not(:disabled)') ?? menu.current)?.focus();
  }, [autoFocus]);

  const returnFromSubmenu = () => {
    submenu?.parent.focus();
    setSubmenu(undefined);
  };
  const openChild = (entry: MenuEntry, parent: HTMLButtonElement, focus: boolean) => {
    setSubmenu(previous => {
      if (!entry.children?.length) return undefined;
      if (previous?.entry === entry && previous.parent === parent && (!focus || previous.focus)) return previous;
      return { entry, parent, focus };
    });
  };
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' || (event.key === 'ArrowLeft' && onBack)) {
      event.preventDefault();
      event.stopPropagation();
      if (submenu) returnFromSubmenu();
      else (onBack ?? onClose)();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (buttons.length) {
        const next = index === -1 ? (event.key === 'ArrowDown' ? 0 : buttons.length - 1)
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        setSubmenu(undefined);
        buttons[next]?.focus();
      }
    } else if (event.key === 'ArrowRight' && event.target instanceof HTMLButtonElement &&
      event.target.getAttribute('aria-haspopup') === 'menu') {
      event.preventDefault();
      event.target.click();
    } else if (event.key === 'Tab') {
      event.preventDefault();
      onClose();
    }
  };

  return <>
    <div ref={menu} className="wb-row-menu" role="menu" aria-label={label} tabIndex={-1}
      onContextMenu={event => event.preventDefault()} onKeyDown={keyDown}>
      {entries.map(entry => <Fragment key={entry.label}>{entry.divider && <hr role="separator" />}
        <button type="button" role="menuitem" disabled={!entry.run && !entry.children?.length}
          aria-haspopup={entry.children?.length ? 'menu' : undefined}
          aria-keyshortcuts={entry.shortcut?.aria}
          aria-expanded={entry.children?.length ? submenu?.entry === entry : undefined}
          title={!entry.run && !entry.children?.length ? unavailable : undefined}
          data-danger={entry.danger || undefined}
          onPointerEnter={event => { if (event.pointerType === 'mouse') openChild(entry, event.currentTarget, false); }}
          onClick={event => {
            if (entry.children?.length) openChild(entry, event.currentTarget, true);
            else if (entry.run) { onClose(); entry.run(); }
          }}>
          {entry.icon && <Glyph icon={entry.icon} />}<span>{entry.label}</span>
          {entry.shortcut && <kbd aria-hidden="true">{entry.shortcut.label}</kbd>}
          {entry.children?.length ? <span aria-hidden="true">›</span> : null}
        </button>
      </Fragment>)}
    </div>
    {submenu?.entry.children && <MenuPanel key={submenu.entry.label} label={submenu.entry.label}
      entries={submenu.entry.children} anchor={{ x: 0, y: 0, parent: submenu.parent }}
      autoFocus={submenu.focus} unavailable={unavailable} onBack={returnFromSubmenu} onClose={onClose} />}
  </>;
}

export function RowMenu({ target, close, unavailable }: { target: MenuTarget; close: () => void; unavailable: string }) {
  const menus = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !menus.current?.contains(event.target)) close();
    };
    window.addEventListener('pointerdown', closeOutside, true);
    window.addEventListener('resize', close);
    return () => { window.removeEventListener('pointerdown', closeOutside, true); window.removeEventListener('resize', close); };
  }, [close]);
  return createPortal(<div ref={menus}>
    <MenuPanel label={target.label} entries={target.entries} anchor={target} autoFocus unavailable={unavailable}
      onClose={() => { close(); target.restore.focus(); }} />
  </div>, document.body);
}
