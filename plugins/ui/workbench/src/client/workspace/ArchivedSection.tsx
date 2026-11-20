import { useState, type MouseEvent } from 'react';
import { Glyph } from './Glyph.js';
import type { SessionId } from './commands.js';
import type { WorkspaceTreeProps } from './WorkspaceTree.js';

type ArchiveProps = Pick<WorkspaceTreeProps, 't' | 'useSessionAccess'>;
type ArchivedChat = { id: SessionId; displayTitle: string };
type ArchivedMenu = (event: MouseEvent, id: SessionId) => void;

function ArchivedRow({ session, restore, menu, t, useSessionAccess }: ArchiveProps & {
  session: ArchivedChat; restore: (id: SessionId) => Promise<void>; menu?: ArchivedMenu;
}) {
  const allowed = useSessionAccess(session.id, 'workspace/unarchiveSession');
  const [pending, setPending] = useState(false);
  const unarchive = async () => {
    setPending(true);
    try { await restore(session.id); }
    finally { setPending(false); }
  };
  return <div className="wb-tree-row" data-row-key={'archived:' + session.id} onContextMenu={menu && (event => menu(event, session.id))}>
    <span className="wb-tree-label wb-archived-title" tabIndex={menu ? -1 : undefined}
      title={session.displayTitle}><span>{session.displayTitle}</span></span>
    <div className="wb-tree-actions">
      {menu && <button type="button" className="wb-tree-action" aria-haspopup="menu" aria-label={t('sessionMenu')}
        title={t('sessionMenu')} onClick={event => menu(event, session.id)}><Glyph icon="more" /></button>}
      {allowed && <button type="button" className="wb-tree-action" disabled={pending} aria-label={t('unarchiveChat')}
        title={t('unarchiveChat')} onClick={() => { void unarchive(); }}><Glyph icon="unarchive" /></button>}
    </div>
  </div>;
}

export function ArchivedSection({ sessions, restore, menu, t, useSessionAccess }: ArchiveProps & {
  sessions: readonly ArchivedChat[]; restore: (id: SessionId) => Promise<void>; menu?: ArchivedMenu;
}) {
  const [expanded, setExpanded] = useState(true);
  return <div className="wb-tree-section" data-workbench-archived>
    <div className="wb-tree-row" data-wb-kind="section">
      <button type="button" className="wb-tree-label" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
        <span>{t('archived')}</span><Glyph icon="section" />
      </button>
    </div>
    {expanded && sessions.map(session => <ArchivedRow key={session.id} session={session} restore={restore} menu={menu}
      useSessionAccess={useSessionAccess} t={t} />)}
  </div>;
}
