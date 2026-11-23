export type Icon = 'folderAdd' | 'projectAdd' | 'project' | 'section' | 'add' | 'new' | 'pin' | 'pinOutline' | 'pinSolid' | 'more' | 'edit' | 'list' | 'archive' | 'unarchive' | 'close';
export function Glyph({ icon }: { icon: Icon }) {
  const paths: Record<Icon, string> = {
    edit: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM10 2h4l1 3 3 1 3 1-1 4 1 3-2 3-3 1-2 4h-4l-1-3-3-1-3-1 1-4-1-3 2-3 3-1 2-4Z',
    list: 'M8 6h13M8 12h13M8 18h13M3 6h.1M3 12h.1M3 18h.1',
    unarchive: 'M3 11v9h18v-9M12 15V3m-5 5 5-5 5 5',
    archive: 'M3 4h18v5H3zM5 9v11h14V9M9 13h6',
    close: 'm5 5 14 14M19 5 5 19',
    folderAdd: 'M2 6h7l2 2h11v11H2V6Zm10 5v5m-2.5-2.5h5',
    projectAdd: 'M3.5 8a2 2 0 0 1 2-2H9l2 2h7.5a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z M12 10.75v5.5m-2.75-2.75h5.5',
    project: 'M2 6h7l2 2h11v11H2V6Z',
    section: 'm6 9 6 6 6-6',
    add: 'M12 5v14M5 12h14',
    new: 'M12 5H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-5.5 M10 14.5l.75-3.25 6.5-6.5a1.77 1.77 0 0 1 2.5 2.5l-6.5 6.5-3.25.75Z',
    pin: 'm10 3 11 11-5 1-4 4-2-5-5-2 4-4 1-5Zm0 11-6 6',
    pinOutline: 'M9 4h6a1 1 0 0 1 .7 1.7L15 6.5v4.2l2.8 2.8a.9.9 0 0 1-.6 1.5H6.8a.9.9 0 0 1-.6-1.5L9 10.7V6.5l-.7-.8A1 1 0 0 1 9 4Z M12 15v6',
    pinSolid: 'M8.75 4h6.5a1.4 1.4 0 0 1 1.08 2.3l-1.08 1.3v3.15l2.55 2.55a1.5 1.5 0 0 1-1.06 2.56H12.8v2.95l-.8 2.32-.8-2.32v-2.95H7.26a1.5 1.5 0 0 1-1.06-2.56l2.55-2.55V7.6L7.67 6.3A1.4 1.4 0 0 1 8.75 4Z',
    more: 'M5 12h.01m6.99 0h.01m6.99 0h.01',
  };
  const solid = icon === 'pinSolid';
  return <svg width="16" height="16" viewBox="0 0 24 24" fill={solid ? 'currentColor' : 'none'} stroke={solid ? 'none' : 'currentColor'}
    strokeWidth={icon === 'more' ? 3 : ['projectAdd', 'new', 'pinOutline'].includes(icon) ? 1.75 : 1.7}
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={paths[icon]} transform={solid || icon === 'pinOutline' ? 'rotate(40 12 12)' : undefined} />
  </svg>;
}
