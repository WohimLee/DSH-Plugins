import { createPortal } from 'react-dom';
import { Glyph } from './Glyph.js';

export function SidebarNotice({ message, closeLabel, onClose, info = false }: {
  message: string; closeLabel: string; onClose: () => void; info?: boolean;
}) {
  return createPortal(<aside className="wb-sidebar-notice" data-workbench-sidebar-notice>
    <p role={info ? 'status' : 'alert'}>{message}</p>
    <button type="button" aria-label={closeLabel} onClick={onClose}><Glyph icon="close" /></button>
  </aside>, document.body);
}
