import type { ScheduledTask } from './scheduled-source.js';

const pageSelector = '[data-slot="main"] [data-testid="task-manager-page"]';
const listSelector = ':scope > div:first-child';
const rowSelector = 'ul > li > button[aria-expanded][aria-describedby]';
const metadataMarker = '-metadata-';
const statusOrder = ['active', 'paused', 'ended', 'all'] as const;

export type NativeScheduleText = (key: string) => string;

export function scheduledFrame(nav: HTMLElement | null): Element | null {
  return nav?.closest('[data-slot="root"] > div') ?? null;
}

export function nativeSchedulePage(frame: Element | null): HTMLElement | null {
  return frame?.querySelector<HTMLElement>(pageSelector) ?? null;
}

function nativeList(page: HTMLElement): HTMLDivElement | null {
  return page.querySelector<HTMLDivElement>(listSelector);
}

function nativeHeading(page: HTMLElement): HTMLHeadingElement | null {
  return nativeList(page)?.querySelector<HTMLHeadingElement>('h1') ?? null;
}

function statusFilter(list: HTMLElement, status: typeof statusOrder[number], t: NativeScheduleText): HTMLButtonElement | undefined {
  const group = [...list.querySelectorAll('[role="group"][aria-label]')]
    .find(element => element.getAttribute('aria-label') === t('statusFilter.label'));
  const buttons = group?.querySelectorAll<HTMLButtonElement>('button[aria-pressed]');
  // rc.5 uses this fixed order. Button identity survives the display rename.
  return buttons?.length === statusOrder.length ? buttons[statusOrder.indexOf(status)] : undefined;
}

function taskId(row: HTMLButtonElement): string | undefined {
  return row.getAttribute('aria-describedby')?.split(metadataMarker).at(1);
}

/** Reversible display labels for rc.5, whose native controls still own task state. */
export function bindNativeSchedule(
  frame: Element,
  labels: { title: string; active: string; search: string },
  t: NativeScheduleText,
  select: (id?: string) => void,
): () => void {
  const texts = new Map<Text, { before: string; after: string }>();
  const attributes = new Map<Element, Map<string, { before: string | null; after: string }>>();
  const patchText = (element: Element | null | undefined, label: string) => {
    const text = element?.firstChild;
    if (!(text instanceof Text) || element?.childNodes.length !== 1 || text.data === label) return;
    texts.set(text, { before: text.data, after: label });
    text.data = label;
  };
  const patchAttribute = (element: Element, name: string, label: string) => {
    const before = element.getAttribute(name);
    if (before === label) return;
    let changes = attributes.get(element);
    if (!changes) attributes.set(element, changes = new Map());
    changes.set(name, { before, after: label });
    element.setAttribute(name, label);
  };
  const sync = () => {
    const page = nativeSchedulePage(frame);
    const list = page && nativeList(page);
    if (!page || !list) return;
    patchText(nativeHeading(page), labels.title);
    patchAttribute(page, 'aria-label', labels.title);
    patchText(statusFilter(list, 'active', t), labels.active);
    const search = list.querySelector('input[type="search"]');
    if (search) {
      patchAttribute(search, 'placeholder', labels.search);
      patchAttribute(search, 'aria-label', labels.search);
    }
    const selected = list.querySelector<HTMLButtonElement>(`${rowSelector}[aria-expanded="true"]`);
    select(selected ? taskId(selected) : undefined);
  };
  sync();
  const watch = new MutationObserver(sync);
  watch.observe(frame, { childList: true, subtree: true, characterData: true, attributes: true,
    attributeFilter: ['aria-label', 'aria-expanded', 'placeholder'] });
  return () => {
    watch.disconnect();
    for (const [text, { before, after }] of texts) if (text.data === after) text.data = before;
    for (const [element, changes] of attributes) {
      for (const [name, { before, after }] of changes) {
        if (element.getAttribute(name) !== after) continue;
        if (before === null) element.removeAttribute(name);
        else element.setAttribute(name, before);
      }
    }
  };
}

function waitForNative(root: Node, trigger: () => boolean): () => void {
  const watch = new MutationObserver(() => { if (trigger()) watch.disconnect(); });
  watch.observe(root, { childList: true, subtree: true });
  if (trigger()) watch.disconnect();
  return () => watch.disconnect();
}

export function openNativeTask(page: HTMLElement, task: ScheduledTask, t: NativeScheduleText): (() => void) | undefined {
  const list = nativeList(page);
  if (!list) return;
  const open = (): boolean => {
    const row = [...list.querySelectorAll<HTMLButtonElement>(rowSelector)].find(button => taskId(button) === task.id);
    if (!row || row.disabled) return false;
    row.click();
    return true;
  };
  if (open()) return;

  // The native manager owns the status filter and query. Reset either only
  // when it prevented the requested task's native row from being rendered.
  const clear = [...list.querySelectorAll<HTMLButtonElement>('button[aria-label]')]
    .find(button => button.getAttribute('aria-label') === t('search.clear'));
  clear?.click();
  const filter = statusFilter(list, task.status, t);
  if (filter?.getAttribute('aria-pressed') === 'false') filter.click();
  return waitForNative(list, open);
}

export function createNativeTask(page: HTMLElement, t: NativeScheduleText): (() => void) | undefined {
  const split = nativeHeading(page)?.parentElement?.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]');
  if (!split || split.disabled) return;
  const doc = page.ownerDocument;
  if (split.getAttribute('aria-expanded') !== 'true') split.click();
  const manual = t('host.manualCreate');
  return waitForNative(doc.body, () => {
    if (split.getAttribute('aria-expanded') !== 'true') return false;
    const menuItem = [...doc.querySelectorAll<HTMLElement>('[role="menuitem"]')]
      .find(item => item.getClientRects().length && item.textContent?.trim() === manual);
    if (!menuItem) return false;
    menuItem.click();
    return true;
  });
}
