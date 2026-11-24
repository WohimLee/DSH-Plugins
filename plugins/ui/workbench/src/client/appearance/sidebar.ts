const trackProperty = '--wb-host-sidebar-track';
const contentTracksProperty = '--wb-host-content-tracks';
const widthProperty = '--wb-resized-sidebar-width';
const sidebarHandle = ':scope > [data-side="sidebar"]';
const minimumWidth = 238;
const maximumWidth = 468;

/** The rc.5 layout service owns visibility but has no public width setter. */
export function installSidebarResize(frame: HTMLElement): () => void {
  const controller = new AbortController();
  const options = { capture: true, signal: controller.signal };
  const desktop = matchMedia('(min-width: 824px)');
  const document = frame.ownerDocument;
  let drag: { handle: HTMLElement; pointer: number; x: number; width: number; scale: number } | undefined;
  const syncTracks = () => {
    // Keep the native center and right tracks, replacing only the expanded left track.
    const tracks = frame.style.gridTemplateColumns.match(/^(\d+(?:\.\d+)?px) (.+)$/);
    const expanded = !frame.hasAttribute('data-sidebar-collapsed') && !frame.hasAttribute('data-sidebar-drawer');
    for (const [property, value] of [[trackProperty, tracks?.[1]], [contentTracksProperty, tracks?.[2]]] as const) {
      const next = expanded ? value ?? '' : '';
      if (frame.style.getPropertyValue(property) !== next) frame.style.setProperty(property, next);
    }
  };
  syncTracks();
  const observer = new MutationObserver(syncTracks);
  observer.observe(frame, { attributes: true, attributeFilter: ['style', 'data-sidebar-collapsed', 'data-sidebar-drawer'] });

  frame.addEventListener('pointerdown', event => {
    const handle = frame.querySelector<HTMLElement>(sidebarHandle);
    if (!desktop.matches || !handle || event.target !== handle || event.button !== 0 || drag) return;
    const width = Number.parseFloat(getComputedStyle(handle).left);
    const scale = frame.getBoundingClientRect().width / frame.offsetWidth;
    if (!Number.isFinite(width) || !Number.isFinite(scale) || scale <= 0) return;
    event.preventDefault();
    event.stopPropagation();
    handle.setPointerCapture(event.pointerId);
    drag = { handle, pointer: event.pointerId, x: event.clientX, width, scale };
  }, options);
  const move = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointer) return;
    event.stopPropagation();
    const desired = Math.round(drag.width + (event.clientX - drag.x) / drag.scale);
    const width = `${Math.min(maximumWidth, Math.max(minimumWidth, desired))}px`;
    if (frame.style.getPropertyValue(widthProperty) !== width) frame.style.setProperty(widthProperty, width);
  };
  const end = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointer) return;
    event.stopPropagation();
    drag = undefined;
  };
  document.addEventListener('pointermove', move, options);
  document.addEventListener('pointerup', event => { move(event); end(event); }, options);
  document.addEventListener('pointercancel', end, options);
  document.addEventListener('lostpointercapture', end, options);

  return () => {
    controller.abort();
    observer.disconnect();
    if (drag?.handle.hasPointerCapture(drag.pointer)) drag.handle.releasePointerCapture(drag.pointer);
    frame.style.removeProperty(trackProperty);
    frame.style.removeProperty(contentTracksProperty);
    frame.style.removeProperty(widthProperty);
  };
}
