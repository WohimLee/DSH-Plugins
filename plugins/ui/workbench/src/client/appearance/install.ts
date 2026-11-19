import { stylesheet } from './styles.js';

/** All document changes belong to the plugin lifetime. */
export function installAppearance(doc: Document | undefined = typeof document === 'undefined' ? undefined : document): () => void {
  if (!doc) return () => {};
  const root = doc.documentElement;
  const previous = root.getAttribute('data-dsh-workbench');
  const style = doc.createElement('style');
  style.dataset.dshWorkbenchStyle = '';
  style.textContent = stylesheet;
  doc.head.append(style);
  root.setAttribute('data-dsh-workbench', 'true');
  return () => {
    style.remove();
    if (root.getAttribute('data-dsh-workbench') !== 'true') return;
    if (previous === null) root.removeAttribute('data-dsh-workbench');
    else root.setAttribute('data-dsh-workbench', previous);
  };
}
