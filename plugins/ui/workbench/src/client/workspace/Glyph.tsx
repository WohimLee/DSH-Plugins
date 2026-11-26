/*!
 * Folder icons from Lucide (ISC License).
 * Copyright (c) 2026 Lucide Icons and Contributors
 *
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
 * ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
 * ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
 * OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 */
export type Icon = 'folderAdd' | 'circleAdd' | 'project' | 'projectOpen' | 'section' | 'add' | 'new' | 'pin' | 'pinOutline' | 'pinSolid' | 'more' | 'edit' | 'list' | 'archive' | 'unarchive' | 'close' | 'search'
  | 'rename' | 'read' | 'unread' | 'fork' | 'share' | 'copy' | 'newWindow' | 'trash' | 'pause' | 'resume' | 'run';

const folderOutline = 'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z';
const strokeWidths: Partial<Record<Icon, number>> = {
  folderAdd: 1.65, project: 1.65, projectOpen: 1.65,
  more: 3, new: 1.75, pinOutline: 1.75,
};

export function Glyph({ icon }: { icon: Icon }) {
  const paths: Record<Icon, string> = {
    edit: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM10 2h4l1 3 3 1 3 1-1 4 1 3-2 3-3 1-2 4h-4l-1-3-3-1-3-1 1-4-1-3 2-3 3-1 2-4Z',
    rename: 'm4 16-1 5 5-1L20 8a2.8 2.8 0 0 0-4-4L4 16Zm10-10 4 4',
    read: 'M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Zm10-2.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 1 0 0-5Z',
    unread: 'M3 3l18 18M10 6.2c.6-.1 1.3-.2 2-.2 6.5 0 10 6 10 6s-1 1.7-2.9 3.3M6.2 7.5C3.5 9.3 2 12 2 12s3.5 6 10 6c1.6 0 3-.4 4.2-1',
    fork: 'M6 8v8m12-8v2a3 3 0 0 1-3 3H9a3 3 0 0 0-3 3m0-12a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm12 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM6 16a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z',
    share: 'M12 15V3m-4 4 4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7',
    copy: 'M8 8h10a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2ZM15 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h1',
    newWindow: 'M13 19H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v7M3 8h18m-3 7v6m-3-3h6',
    pause: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0ZM10 9v6m4-6v6',
    resume: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Zm-12-4 6 4-6 4V8Z',
    run: 'M21 4v6h-6m6 0a9 9 0 1 0 .2 4',
    trash: 'M4 6h16M9 6V3h6v3m-9 0 1 15h10l1-15M10 10v7m4-7v7',
    list: 'M8 6h13M8 12h13M8 18h13M3 6h.1M3 12h.1M3 18h.1',
    unarchive: 'M3 11v9h18v-9M12 15V3m-5 5 5-5 5 5',
    archive: 'M3 4h18v5H3zM5 9v11h14V9M9 13h6',
    close: 'm5 5 14 14M19 5 5 19',
    search: 'M15.5 15.5 21 21m-3-10.5a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0Z',
    folderAdd: folderOutline + 'M12 10v6M9 13h6',
    circleAdd: 'M12 2a10 10 0 1 0 0 20 10 10 0 1 0 0-20ZM12 8v8M8 12h8',
    project: folderOutline + 'M2 10h20',
    projectOpen: 'm6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2',
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
    strokeWidth={strokeWidths[icon] ?? 1.7}
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={paths[icon]} transform={solid || icon === 'pinOutline' ? 'rotate(40 12 12)' : undefined} />
  </svg>;
}
