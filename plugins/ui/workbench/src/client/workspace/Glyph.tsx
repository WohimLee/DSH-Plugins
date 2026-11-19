export type Icon = 'folderAdd' | 'project' | 'section' | 'add' | 'new' | 'pin' | 'more' | 'edit' | 'list' | 'archive' | 'close';
export function Glyph({ icon }: { icon: Icon }) {
  const paths: Record<Icon, string> = {
    edit: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM10 2h4l1 3 3 1 3 1-1 4 1 3-2 3-3 1-2 4h-4l-1-3-3-1-3-1 1-4-1-3 2-3 3-1 2-4Z',
    list: 'M8 6h13M8 12h13M8 18h13M3 6h.1M3 12h.1M3 18h.1',
    archive: 'M3 4h18v5H3zM5 9v11h14V9M9 13h6',
    close: 'm5 5 14 14M19 5 5 19',
    folderAdd: 'M2 6h7l2 2h11v11H2V6Zm10 5v5m-2.5-2.5h5',
    project: 'M2 6h7l2 2h11v11H2V6Z',
    section: 'm6 9 6 6 6-6',
    add: 'M12 5v14M5 12h14',
    new: 'M16 5H5v14h14V8m-4 6 6-6-3-3-6 6-1 4 4-1Z',
    pin: 'm10 3 11 11-5 1-4 4-2-5-5-2 4-4 1-5Zm0 11-6 6',
    more: 'M5 12h.01m6.99 0h.01m6.99 0h.01',
  };
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={icon === 'more' ? 3 : 1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={paths[icon]} />
  </svg>;
}
