import type { Context } from '@deepseek-ai/cordis';
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';

const property = '--dsh-workbench-zoom';
const minimum = 70;
const maximum = 150;
const defaultScale = 100;
const fadeDelay = 2600;

interface ZoomState { readonly scale: number; readonly shown: boolean }
interface ZoomControls {
  adjust: (delta: -1 | 1) => void;
  reset: () => void;
  hold: (held: boolean) => void;
}

function ZoomNotice({ useZoom, adjust, reset, hold, t }: PropsRuntime<'shell.overlay'> & PropsLocale<'workbench'> & InjectFace<ZoomControls & {
  hooks: { zoom: HostObservable<ZoomState> };
}>) {
  const { scale, shown } = useZoom(state => state);
  if (!shown) return null;
  return <div className="wb-zoom" data-workbench-zoom role="group" aria-label={t('zoom')}
    onPointerEnter={() => hold(true)} onPointerLeave={event => hold(event.currentTarget.contains(document.activeElement))}
    onFocus={() => hold(true)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) hold(event.currentTarget.matches(':hover')); }}>
    <output aria-live="polite">{scale}%</output>
    <button className="wb-control" type="button" disabled={scale === minimum} aria-label={t('zoomOut')} onClick={() => adjust(-1)}>−</button>
    <button className="wb-control" type="button" disabled={scale === maximum} aria-label={t('zoomIn')} onClick={() => adjust(1)}>+</button>
    <button className="wb-control" type="button" onClick={reset}>{t('zoomReset')}</button>
  </div>;
}

export function registerZoom(ctx: Context): void {
  if (typeof document === 'undefined' || document.documentElement.dataset.platform !== 'darwin') return;
  const root = document.documentElement;
  const listeners = new Set<() => void>();
  const zoom: HostObservable<ZoomState> = {
    getSnapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
  let state: ZoomState = { scale: defaultScale, shown: false };
  let timer: number | undefined;
  let held = false;
  const publish = (next: ZoomState) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const hold = (value: boolean) => {
    held = value;
    window.clearTimeout(timer);
    if (!held) timer = window.setTimeout(() => publish({ scale: state.scale, shown: false }), fadeDelay);
  };
  const setScale = (scale: number) => {
    if (scale === defaultScale) root.style.removeProperty(property);
    else root.style.setProperty(property, String(scale / defaultScale));
    publish({ scale, shown: true });
    hold(held);
  };
  const adjust = (delta: -1 | 1) => setScale(Math.min(maximum, Math.max(minimum, state.scale + delta * 10)));
  const reset = () => setScale(defaultScale);
  const onKey = (event: KeyboardEvent) => {
    if (!event.metaKey || event.altKey || event.ctrlKey || event.isComposing || event.defaultPrevented) return;
    const delta = event.key === '-' || event.key === '_' ? -1 : event.key === '=' || event.key === '+' ? 1 : undefined;
    if (delta === undefined) return;
    // The pinned host's font-size handler reads the same keys in window bubble phase.
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!event.repeat) adjust(delta);
  };
  ctx.effect(() => {
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.clearTimeout(timer);
      root.style.removeProperty(property);
      listeners.clear();
    };
  });
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'dsh-workbench:zoom', order: 100, locale: 'workbench',
    inject: () => ({ adjust, reset, hold, hooks: { zoom } }),
  }, ZoomNotice));
}
