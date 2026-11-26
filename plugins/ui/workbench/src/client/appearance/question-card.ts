const cardSelector = '[data-question-key]';
const pagerSelector = 'section > footer > div:first-child:has(> button[aria-label] + span + button[aria-label]:last-child)';
const optionSelector = '[data-option-row] > button:is([role="radio"], [role="checkbox"]):enabled';
const singlePager = 'data-wb-single-question-pager';

function isVisible(element: Element): boolean {
  return element.getClientRects().length > 0 && getComputedStyle(element).visibility === 'visible';
}

function markSinglePager(root: ParentNode): void {
  for (const pager of root.querySelectorAll(`${cardSelector} > ${pagerSelector}`)) {
    // rc.5 writes the numeric progress even when both controls are disabled.
    const progress = pager.querySelector(':scope > span')?.textContent ?? '';
    pager.toggleAttribute(singlePager, /^\s*1\s*\/\s*1\s*$/.test(progress));
  }
}

export function installQuestionCards(doc: Document): () => void {
  const view = doc.defaultView;
  if (!view) return () => {};
  const requestFrame = view.requestAnimationFrame.bind(view);
  let active = true;

  function keydown(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229 ||
        event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const target = event.target;
    const element = target instanceof Element ? target : undefined;
    if (element?.closest('input, textarea, select, [contenteditable], [role="textbox"], a, [role="menu"]')) return;
    let card = element?.closest(cardSelector);
    if (!card && (target === doc || target === doc.body || target === doc.documentElement)) {
      const dialogs = doc.querySelectorAll('dialog[open], [role="dialog"], [role="alertdialog"], [aria-modal="true"]');
      if ([...dialogs].some(isVisible)) return;
      // Option questions do not take focus on opening. Only an unambiguous
      // live card may handle a key normally sent to the page itself.
      const cards = [...doc.querySelectorAll(`${cardSelector}:has(> section > footer > div:last-child > button)`)]
        .filter(isVisible);
      if (cards.length === 1) [card] = cards;
    }
    if (!card?.querySelector('[data-question-scroll]')) return;

    const options = [...card.querySelectorAll<HTMLButtonElement>(optionSelector)];
    let control: HTMLButtonElement | undefined;
    switch (event.key) {
      case 'ArrowUp':
      case 'ArrowDown': {
        const current = options.findIndex(option => option.contains(element ?? null));
        const next = current < 0
          ? event.key === 'ArrowDown' ? 0 : options.length - 1
          : current + (event.key === 'ArrowDown' ? 1 : -1);
        options[next]?.focus();
        if (options[next]) event.preventDefault();
        return;
      }
      case 'ArrowLeft':
      case 'ArrowRight': {
        const pager = card.querySelector(`:scope > ${pagerSelector}`);
        const edge = event.key === 'ArrowLeft' ? 'first' : 'last';
        control = pager?.querySelector<HTMLButtonElement>(`:scope > button:${edge}-child:enabled`) ?? undefined;
        break;
      }
      default:
        if (!event.repeat && /^[1-9]$/.test(event.key)) control = options[Number(event.key) - 1];
    }
    if (!control) return;
    event.preventDefault();
    control.focus();
    control.click();
    // Selecting an answer or turning a page can unmount the focused control.
    const returnFocusToCard = card;
    requestFrame(() => {
      if (!active || !returnFocusToCard.isConnected) return;
      const focused = doc.activeElement;
      if (focused === doc.body || (focused === control && control.disabled)) {
        returnFocusToCard.querySelector<HTMLButtonElement>(optionSelector)?.focus();
      }
    });
  }

  const observer = new MutationObserver(changes => {
    for (const change of changes) {
      for (const node of change.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches(cardSelector) || node.querySelector(cardSelector) ||
            node.matches('footer') && node.closest(cardSelector)) {
          markSinglePager(doc);
          return;
        }
      }
    }
  });
  markSinglePager(doc);
  observer.observe(doc.body, { childList: true, subtree: true });
  doc.addEventListener('keydown', keydown);
  return () => {
    active = false;
    observer.disconnect();
    doc.removeEventListener('keydown', keydown);
    for (const pager of doc.querySelectorAll(`[${singlePager}]`)) pager.removeAttribute(singlePager);
  };
}
