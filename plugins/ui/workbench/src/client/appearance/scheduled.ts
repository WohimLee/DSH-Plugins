// The rc.5 Schedule page owns the catalog, row activation and detail state.
// Its test anchor and described task buttons distinguish the list from its editor.
const page = 'html[data-dsh-workbench] [data-testid="task-manager-page"]';
const list = `${page} > div:first-child ul:has(> li > button[aria-expanded][aria-describedby])`;
const row = `${list} > li > button[aria-expanded][aria-describedby]`;
const text = `${row} > span`;
const content = `${page} > div:first-child > div > div:has(> div > h1)`;
const heading = `${content} > div:has(> h1)`;
const darwinHeading = heading.replace('html[data-dsh-workbench]', 'html[data-dsh-workbench][data-platform="darwin"]');
const frame = 'html[data-dsh-workbench] [data-slot="root"] > div:not([data-sidebar-drawer]):has([data-testid="task-manager-page"])';

export const scheduledStyles = `
${list} { gap: 0; }
${row} { min-block-size: 49px; padding-block: 6px; }
${text} > span:first-child { font-size: 14px; line-height: 19px; }
${text} > span[id],
${text} > span[id] :is(span, time) { font-size: 12px; line-height: 16px; }
${heading} { padding-block-start: 25px; }
${darwinHeading} { padding-block-start: calc(25px + var(--dsh-frame-top-clearance, 0px)); }

.wb-scheduled-navigation { display: none; }
@media (min-width: 824px) {
  ${content} { padding-inline: var(--wb-page-inset, clamp(24px, 4vw, 48px)); }
  ${frame} .wb-scheduled-navigation {
    display: flex;
    flex-direction: column;
    position: absolute;
    inset-block: var(--dsh-frame-top-clearance, 0px) 0;
    inset-inline-start: 0;
    inline-size: var(--wb-secondary-width);
    box-sizing: border-box;
    overflow: auto;
    overscroll-behavior: contain;
    pointer-events: auto;
    border-inline-end: 1px solid var(--wb-sidebar-border, var(--dsw-alias-border-primary, #8882));
    background: var(--wb-sidebar-fill, var(--dsw-specific-sidebar-fill));
    color: var(--dsw-alias-label-primary);
  }
}
.wb-scheduled-navigation :is(button, summary) {
  appearance: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding-inline: 8px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 13px;
  text-align: start;
  cursor: pointer;
  -webkit-app-region: no-drag;
}
.wb-scheduled-navigation :is(button, summary):hover {
  background: var(--dsw-alias-background-hover, #8882);
}
.wb-scheduled-navigation :is(button, summary):focus-visible {
  outline: 2px solid var(--dsw-alias-accent-primary, #4c95f6);
  outline-offset: -2px;
}
.wb-scheduled-new { min-block-size: 31px; }
.wb-scheduled-group { margin-block-start: 12px; }
.wb-scheduled-group-title,
.wb-scheduled-paused summary { padding: 4px 8px; color: var(--dsw-alias-label-secondary); font-size: 13px; }
.wb-scheduled-paused { margin-block-start: 12px; }
.wb-scheduled-paused summary { list-style: none; inline-size: 100%; box-sizing: border-box; }
.wb-scheduled-paused summary::-webkit-details-marker { display: none; }
.wb-scheduled-paused summary svg { width: 13px; height: 13px; transform: rotate(-90deg); }
.wb-scheduled-paused[open] summary svg { transform: none; }
.wb-scheduled-paused p { font-size: 12px; padding-inline: 8px; color: var(--dsw-alias-label-secondary); }
.wb-scheduled-navigation .wb-scheduled-row {
  display: grid;
  grid-template-rows: 20px 16px;
  gap: 2px;
  inline-size: 100%;
  min-inline-size: 0;
  min-block-size: 49px;
  box-sizing: border-box;
  padding-block: 5px 6px;
}
.wb-scheduled-row > :is(span, small) {
  min-inline-size: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wb-scheduled-row small { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 16px; }
.wb-scheduled-navigation .wb-scheduled-row[aria-current] { background: var(--dsw-alias-background-active, #8883); }
`;
