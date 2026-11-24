import type { ReactNode } from 'react';
import type { Context } from '@deepseek-ai/cordis';
import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type {} from '@deepseek-ai/dsh-client-ui-session/client';
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client';
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client';
import type { ModelDirectory } from '@deepseek-ai/dsh-client-ui-model-selection/client';
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type {} from '@deepseek-ai/dsh-client-locale/client';
import { contribution } from '../remote.js';
import { Picker } from './picker.js';
import { messages } from './messages.js';
import { ModelManagement } from './management.js';
import { ManagementIcon } from './icons.js';
import { managementStyles } from './management-styles.js';

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { modelPicker: keyof typeof messages.en }
  interface ModelPickerConnectionCard {
    id: string;
    name: string;
    status: string;
    tone: 'neutral' | 'ready' | 'warning';
    description?: string;
    footer?: string;
    action: string;
    details: ReactNode;
    connection?: {
      connected: boolean;
      accountCount?: number;
      busy?: boolean;
      desktop?: ReactNode;
      api?: ReactNode;
      setup?: { desktop?: ReactNode; api?: ReactNode };
    };
  }
  interface ModelPickerConnectionsOwner {
    renderCard?: (card: ModelPickerConnectionCard) => ReactNode;
    refresh?: number;
  }
  interface SlotMap {
    'modelPicker.connections': { kind: 'list'; scope: 'root'; owner: ModelPickerConnectionsOwner }
  }
}

const key = 'dsh-model-picker';
export const inject = ['slots', 'locale', 'modelDirectories', 'sessions', 'remote'];

export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const unmount = await ctx.remote.$mount(contribution);
  try {
    const binding = ctx.inject(['remote.dshModelPickerUsage', 'remote.session'], register);
    return async () => { try { await binding.dispose(); } finally { await unmount(); } };
  } catch (error) {
    await unmount();
    throw error;
  }
}

function register(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('modelPicker', messages));
  const style = document.createElement('style');
  style.dataset.dshModelPickerStyle = '';
  style.textContent = managementStyles + pickerStyles;
  ctx.effect(() => {
    document.head.append(style);
    return () => style.remove();
  });
  const panelId = key as MainPanelId;
  const label = ctx.locale.bind('modelPicker');
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main', key: panelId, locale: 'modelPicker',
    children: { 'modelPicker.connections': { kind: 'list', scope: 'root' } },
  }, props => <ModelManagement {...props} ctx={ctx} language={ctx.locale.getSnapshot().active} />));
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist', id: panelId, label: () => label('management'), order: 10,
  }, ({ size }) => <ManagementIcon name="cable" size={size} />));
  ctx.slots.inject('conversation.input.model.options', () => ctx.slots.register({
    name: 'conversation.input.model.options', id: key, order: -100, locale: 'modelPicker',
    inject: sessionId => ({ directory: ctx.sessions.subagentAddress(sessionId) === undefined
      ? ctx.modelDirectories.directoryFor(sessionId) : undefined }),
  }, ({ directory, ...props }) => directory
    ? <ModelsOption {...props} directory={directory} ctx={ctx} />
    : null));
}

type OptionsProps = Pick<PropsRuntime<'conversation.input.model.options'>, 'locked' | 'dismiss' | 'reportFailure'>
  & PropsLocale<'modelPicker'> & { directory: ModelDirectory; ctx: Context };

function ModelsOption({ directory, ctx, t, ...props }: OptionsProps) {
  const [branch, setBranch] = useState<'models' | 'effort'>();
  const element = useRef<HTMLButtonElement>(null);
  const effort = useRef<HTMLButtonElement | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const { current, groups } = useSyncExternalStore(directory.store.subscribe, directory.store.getSnapshot);
  const model = groups.find(group => group.id === current?.provider)?.models.find(model => model.id === current?.model);
  const reasoning = model?.reasoning;
  const locked = useRef(props.locked);
  locked.current = props.locked;

  const cancelClose = useCallback(() => clearTimeout(timer.current), []);
  const open = useCallback((next: 'models' | 'effort') => {
    cancelClose();
    if (!locked.current) setBranch(next);
  }, [cancelClose]);
  const scheduleClose = useCallback((event: Pick<PointerEvent, 'pointerType' | 'relatedTarget'>) => {
    if (event.pointerType !== 'mouse') return;
    const target = event.relatedTarget;
    if (target instanceof Node && [element.current, effort.current, panel.current].some(node => node?.contains(target))) return;
    cancelClose();
    timer.current = setTimeout(() => setBranch(undefined), 180);
  }, [cancelClose]);

  useLayoutEffect(() => {
    // The rc.5 options slot follows the stock model/effort rows. Preserve the
    // native Effort click/keyboard path and only add a mouse hover affordance.
    const nativeRow = element.current?.closest('[role="menu"]')?.querySelector<HTMLButtonElement>(
      ':scope > button[role="menuitem"]:has([data-provider-id][data-model-id])',
    );
    if (!nativeRow) return;
    const { disabled } = nativeRow;
    nativeRow.disabled = true;
    nativeRow.dataset.dshModelPickerHidden = '';
    const sibling = nativeRow.nextElementSibling;
    const effortRow = reasoning && sibling instanceof HTMLButtonElement && sibling.matches('[role="menuitem"]')
      ? sibling : null;
    effort.current = effortRow;
    const enter = (event: PointerEvent) => {
      if (event.pointerType === 'mouse' && !effortRow?.disabled) open('effort');
    };
    const enterEffort = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowRight' || locked.current) return;
      event.preventDefault();
      event.stopPropagation();
      effortRow?.click();
    };
    effortRow?.addEventListener('pointerenter', enter);
    effortRow?.addEventListener('pointerleave', scheduleClose);
    effortRow?.addEventListener('keydown', enterEffort);
    return () => {
      cancelClose();
      effortRow?.removeEventListener('pointerenter', enter);
      effortRow?.removeEventListener('pointerleave', scheduleClose);
      effortRow?.removeEventListener('keydown', enterEffort);
      effort.current = null;
      nativeRow.disabled = disabled;
      delete nativeRow.dataset.dshModelPickerHidden;
    };
  }, [reasoning, open, scheduleClose, cancelClose]);

  useLayoutEffect(() => {
    const surface = panel.current;
    const row = element.current;
    const menu = row?.closest('[role="menu"]');
    if (!surface || !menu) return;
    const wide = window.matchMedia('(min-width: 390px) and (pointer: fine)');
    const place = () => {
      if (wide.matches) {
        placeModelsPanel(surface, menu.getBoundingClientRect(), branch === 'effort' ? 144 : 350);
      } else {
        surface.removeAttribute('style');
        delete surface.dataset.side;
      }
    };
    place();
    const resize = new ResizeObserver(place);
    resize.observe(menu);
    resize.observe(surface);
    window.addEventListener('resize', place);
    return () => {
      resize.disconnect();
      window.removeEventListener('resize', place);
    };
  }, [branch]);

  function show(focus: boolean): void {
    open('models');
    if (focus) requestAnimationFrame(() => panel.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus());
  }

  function back(): void {
    cancelClose();
    (branch === 'effort' ? effort.current : element.current)?.focus();
    setBranch(undefined);
  }

  function chooseEffort(level: string | undefined): void {
    if (props.locked || !current) return;
    if ((current.reasoningEffort ?? reasoning?.defaultEffort) === level) { props.dismiss(); return; }
    void directory.select({ provider: current.provider, model: current.model, ...(level === undefined ? {} : { reasoningEffort: level }) })
      .then(result => { if (result.ok) props.dismiss(); else props.reportFailure(t('selectionFailed')); })
      .catch(() => props.reportFailure(t('selectionFailed')));
  }

  const effective = current?.reasoningEffort ?? reasoning?.defaultEffort;
  const choices = reasoning ? [
    ...(reasoning.defaultEffort === undefined ? [{ id: undefined, name: t('providerDefault') }] : []),
    ...reasoning.efforts,
  ] : [];
  return <div>
    <button ref={element} type="button" role="menuitem" className="dsh-model-picker-entry" aria-haspopup="true"
      aria-expanded={branch === 'models'} disabled={props.locked} onPointerEnter={event => {
        if (event.pointerType === 'mouse') show(false);
      }} onPointerLeave={scheduleClose} onClick={event => show(event.detail === 0)} onKeyDown={event => {
        if (event.key === 'ArrowRight') {
          event.preventDefault();
          event.stopPropagation();
          show(true);
        }
      }}>
      <span>{t('models')}</span>
      {model && <span className="dsh-model-picker-current">{model.name}</span>}
      <span aria-hidden="true">›</span>
    </button>
    {branch && <div ref={panel} className="dsh-model-picker-flyout" data-branch={branch}
      onPointerEnter={cancelClose} onPointerLeave={scheduleClose}>
      {branch === 'models' ? <Picker {...props} {...{ directory, ctx, t, back }} />
        : <div data-dsh-model-picker="" className="picker-surface picker-effort" role="group"
          aria-label={t('effort')} onKeyDown={event => {
            if (event.key !== 'Escape' && event.key !== 'ArrowLeft') return;
            event.preventDefault();
            event.stopPropagation();
            back();
          }}>
          {choices.map(choice => <button key={choice.id ?? ''} type="button" role="menuitemradio"
            aria-checked={choice.id === effective} disabled={props.locked} onClick={() => chooseEffort(choice.id)}>
            {choice.name}{choice.id === effective && <span aria-hidden="true">✓</span>}
          </button>)}
        </div>}
    </div>}
  </div>;
}

function placeModelsPanel(panel: HTMLElement, menu: DOMRect, preferredWidth: number): void {
  const inset = 12;
  const { innerWidth, innerHeight } = window;
  // Client rectangles and the window are in viewport pixels. Lengths set on the
  // child are local to the menu and inherit its CSS zoom (including Workbench's).
  const zoom = panel.currentCSSZoom;
  const rightRoom = (innerWidth - menu.right - inset) / zoom;
  const leftRoom = (menu.left - inset) / zoom;
  const side = rightRoom >= preferredWidth ? 'right' : leftRoom >= preferredWidth ? 'left' : undefined;
  panel.dataset.side = side ?? 'stack';
  if (side) {
    panel.style.width = `${Math.min(preferredWidth, side === 'right' ? rightRoom : leftRoom)}px`;
    panel.style.setProperty('--picker-panel-height', `${(innerHeight - 2 * inset) / zoom}px`);
    const height = panel.getBoundingClientRect().height;
    const top = Math.max(inset, Math.min(menu.top, innerHeight - inset - height));
    Object.assign(panel.style, {
      left: side === 'right' ? '100%' : 'auto',
      right: side === 'left' ? '100%' : 'auto',
      top: `${(top - menu.top) / zoom}px`,
      bottom: 'auto',
    });
    return;
  }

  const width = Math.min(preferredWidth, (innerWidth - 2 * inset) / zoom);
  const left = Math.max(inset, Math.min(menu.right, innerWidth - inset) - width * zoom);
  const above = menu.top - inset;
  const below = innerHeight - menu.bottom - inset;
  const useAbove = above >= below;
  panel.style.setProperty('--picker-panel-height', `${Math.max(0, above, below) / zoom}px`);
  Object.assign(panel.style, {
    width: `${width}px`,
    left: `${(left - menu.left) / zoom}px`,
    right: 'auto',
    top: useAbove ? 'auto' : '100%',
    bottom: useAbove ? '100%' : 'auto',
  });
}

const pickerStyles = `
[data-dsh-model-picker-hidden] { display: none; }
@media (min-width: 390px) and (pointer: fine) {
  [role="menu"]:has(.dsh-model-picker-flyout) { overflow: visible; }
  .dsh-model-picker-flyout {
    position: absolute; z-index: 1; box-sizing: border-box; pointer-events: none;
    max-block-size: var(--picker-panel-height, calc(100dvh - 24px));
  }
  .dsh-model-picker-flyout[data-branch="models"] > [data-dsh-model-picker] {
    display: grid; grid-template-columns: 144px minmax(0, 1fr); align-items: stretch;
  }
  .dsh-model-picker-flyout[data-side="left"] > [data-dsh-model-picker] {
    grid-template-columns: minmax(0, 1fr) 144px;
  }
  .dsh-model-picker-flyout[data-side="left"] .picker-primary { grid-column: 2; grid-row: 1; }
  .dsh-model-picker-flyout[data-side="left"] .picker-models { grid-column: 1; grid-row: 1; }
  [data-dsh-model-picker] .picker-models { contain: size; }
}
.dsh-model-picker-entry, [data-dsh-model-picker] button {
  width: 100%; border: 0; border-radius: var(--dsw-radius-md, 6px);
  background: transparent; color: inherit; font: inherit; text-align: start;
}
.dsh-model-picker-entry {
  display: flex; align-items: center; gap: 8px; min-height: 30px; padding: 5px 8px; font-size: 13px;
}
.dsh-model-picker-current {
  flex: 1; min-width: 0; text-align: end; color: var(--dsw-alias-label-secondary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dsh-model-picker-entry > :last-child { margin-inline-start: auto; }
.dsh-model-picker-entry:not(:disabled):is(:hover, :focus-visible),
[data-dsh-model-picker] button:not(:disabled):is(:hover, :focus-visible, [aria-current="true"], [aria-checked="true"]) {
  background: var(--dsw-alias-interactive-bg-hover, rgb(127 127 127 / .18));
}
[data-dsh-model-picker] {
  --picker-list-height: max(64px, calc(var(--picker-panel-height, 100dvh - 184px) - 34px));
  font-size: 13px;
}
[data-dsh-model-picker] .picker-surface, [data-dsh-model-picker].picker-surface {
  min-width: 0; box-sizing: border-box; pointer-events: auto; padding: 3px;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: var(--dsw-radius-lg, 8px);
  box-shadow: var(--dsw-elevation-prominent);
  background: var(--dsw-alias-bg-module-platform, Canvas); color: var(--dsw-alias-label-primary, CanvasText);
}
[data-dsh-model-picker] input, [data-dsh-model-picker] select {
  font: inherit; color: inherit; border: 1px solid var(--dsw-alias-border-l1);
  background: transparent; border-radius: var(--dsw-radius-md, 6px); padding: 6px;
}
[data-dsh-model-picker] input {
  width: 100%; box-sizing: border-box; margin-bottom: 3px; padding: 4px 6px; font-size: 12px;
}
[data-dsh-model-picker] option { color: CanvasText; background: Canvas; }
[data-dsh-model-picker] :is(.picker-models, .picker-providers, .picker-search-results),
[data-dsh-model-picker].picker-effort {
  min-width: 0; overflow-y: auto; scrollbar-width: thin; max-block-size: var(--picker-list-height);
}
[data-dsh-model-picker] button { display: flex; justify-content: space-between; align-items: center; gap: 4px; padding: 3px 6px; min-height: 25px; }
[data-dsh-model-picker] [data-provider-row] { min-height: 28px; }
[data-dsh-model-picker] [data-provider-row][aria-expanded="true"] {
  background: var(--dsw-alias-interactive-bg-hover, rgb(127 127 127 / .18));
}
[data-dsh-model-picker] button:disabled { opacity: .55; }
[data-dsh-model-picker] .picker-title {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
[data-dsh-model-picker] .picker-detail { color: var(--dsw-alias-label-secondary); font-size: 11px; }
[data-dsh-model-picker] .picker-back { display: none; }
[data-dsh-model-picker] .picker-account { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; padding: 3px 7px; }
[data-dsh-model-picker] .picker-account select { max-width: 100%; min-width: 0; padding: 3px 6px; }
[data-dsh-model-picker] .picker-section { margin: 4px 7px 1px; }
@media (max-width: 389px), (pointer: coarse) {
  [role="menu"]:has(.dsh-model-picker-flyout) {
    width: min(380px, calc(100vw - 24px)); max-width: calc(100vw - 24px); overflow-y: auto;
  }
  [data-dsh-model-picker] .picker-models { border: 0; padding: 0; }
  [data-dsh-model-picker] .picker-providers { padding: 0; max-block-size: min(168px, var(--picker-list-height)); }
  [data-dsh-model-picker][data-entered="true"] .picker-primary { display: none; }
  [data-dsh-model-picker] .picker-back { display: flex; justify-content: start; }
  [data-dsh-model-picker] button { min-height: 32px; }
  [data-dsh-model-picker] input { font-size: 16px; }
}
`;
