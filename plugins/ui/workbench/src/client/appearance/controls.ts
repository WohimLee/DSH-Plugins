import { conversationStyles } from './conversation.js';

export const controlStyles = `
${conversationStyles}
.wb-control {
  appearance: none; border: 1px solid transparent; border-radius: 7px; padding: 5px 8px;
  font: inherit; color: inherit; background: var(--dsw-alias-background-hover, #8882);
  cursor: pointer; -webkit-app-region: no-drag;
}
.wb-control:hover, .wb-control[aria-pressed="true"] { background: var(--dsw-alias-background-active, #8883); }
.wb-control:disabled { opacity: .45; cursor: default; }
.wb-control:focus-visible { outline: 2px solid var(--dsw-alias-accent-primary, #4c95f6); }
.wb-section-session { display: flex; inline-size: 100%; min-inline-size: 0; }
.wb-section-session .wb-new-section {
  display: flex; align-items: center; gap: 8px; width: 100%; min-height: 32px; padding: 4px 6px;
  text-align: start; border: 0; background: transparent;
}
.wb-section-session .wb-new-section:hover { background: var(--dsw-alias-background-hover, #8882); }
.wb-section-action { display: flex; align-items: center; gap: 2px; flex: none; }
.wb-section-trigger { display: grid; place-items: center; width: 28px; height: 28px; padding: 0; background: transparent; color: var(--dsw-alias-label-secondary, #999); }
html[data-dsh-workbench] [data-window-drag]:has([data-workbench-brand]) { height: 48px; gap: 4px; }
.wb-inline-name input, .wb-directory input, .wb-rename-session input, .wb-guide input {
  border: 1px solid var(--dsw-alias-border-primary, #8884); border-radius: 7px; color: inherit;
  background: var(--dsw-alias-background-hover, #8882); padding: 7px 9px; font: inherit; min-inline-size: 0;
}
.wb-session-search {
  inset-block: min(15vh, 120px) auto; box-sizing: border-box; width: min(500px, calc(100vw - 32px));
  max-height: 70vh; max-height: 70dvh; overflow: auto; padding: 0;
  color: var(--dsw-alias-label-primary, #eee); background: var(--dsw-specific-sidebar-fill, #252525);
  border: 1px solid var(--dsw-alias-border-primary, #8884); border-radius: 14px; box-shadow: 0 8px 26px #0005;
  font-size: 13px; line-height: 19px;
}
.wb-session-search::backdrop { background: #0005; }
.wb-search-field {
  display: flex; align-items: center; gap: 8px; padding: 8px 12px;
  border-bottom: 1px solid var(--dsw-alias-border-primary, #8884);
}
.wb-search-field input { flex: 1; min-inline-size: 0; border: 0; padding: 4px; background: transparent; color: inherit; font: inherit; }
.wb-search-field .wb-control { display: grid; place-items: center; background: transparent; }
.wb-search-field .wb-control:hover { background: var(--dsw-alias-background-hover, #8882); }
.wb-session-search ul { margin: 0; padding: 6px; list-style: none; }
.wb-session-search li button {
  display: grid; gap: 2px; width: 100%; box-sizing: border-box; padding: 7px 8px;
  border: 0; border-radius: 6px; background: transparent; color: inherit; font: inherit; text-align: start;
}
.wb-session-search li button:is(:hover, :focus-visible) { background: var(--dsw-alias-background-hover, #8882); cursor: pointer; }
.wb-session-search li :is(span, small) { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.wb-session-search :is(p, small) { color: var(--dsw-alias-label-secondary, #aaa); }
.wb-session-search p { margin: 10px 12px; }
.wb-panel-popup {
  position: fixed; z-index: 20; inset: auto auto 16px calc(var(--dsh-workbench-rail) + 6px);
  max-block-size: 60vh; max-inline-size: min(280px, 70vw); overflow: auto;
  padding: 6px; border-radius: 10px; box-shadow: 0 6px 22px #0005;
  border: 1px solid var(--dsw-alias-border-primary, #8884);
  background: var(--dsw-specific-sidebar-fill, #252525); color: var(--dsw-alias-label-primary, #eee);
}
@media (min-width: 824px) {
  /* SidebarRoot at the pinned host version puts the global navigation first in this scrollport. */
  html[data-dsh-workbench] [data-slot="root"] > div:not([data-sidebar-drawer]) [data-sidebar-scrollport] > nav:first-child { display: none; }
}

.wb-panel-menu-row { display: flex; gap: 4px; }
.wb-panel-menu-row + .wb-panel-menu-row { margin-block-start: 4px; }
.wb-panel-menu-row button:first-child { flex: 1; text-align: start; }
.wb-header-controls { display: flex; align-items: center; gap: 4px; position: relative; }
.wb-header-controls > .wb-control, .wb-share > .wb-control { display: inline-grid; place-items: center; background: transparent; }
.wb-header-controls > .wb-control:hover, .wb-header-controls > .wb-control[aria-expanded="true"] {
  background: var(--dsw-alias-background-active, #8883);
}
[data-workbench-summary-frame] { display: contents; }
[data-workbench-summary-frame]:has(> [data-workbench-summary]) {
  position: relative; display: flex; flex: 1; min-block-size: 0;
  container: wb-summary / inline-size;
}
[data-workbench-summary-frame] > [data-conversation-scroll] { min-inline-size: 0; }
.wb-pinned-summary {
  position: absolute; z-index: 5; inset: calc(100% + 8px) 0 auto auto;
  display: grid; grid-template-columns: minmax(0, 1fr); gap: 4px;
  inline-size: min(300px, calc(100vw - 32px));
  max-block-size: min(70vh, 600px); box-sizing: border-box; overflow: hidden auto; padding: 12px 16px;
  font-size: 13px; line-height: 18px;
  color: var(--dsw-alias-label-primary, #eee); background: var(--wb-summary-fill);
  border: 1px solid var(--wb-seam); border-radius: 16px; box-shadow: 0 6px 22px #0004;
  -webkit-app-region: no-drag;
}
[data-workbench-summary-frame] > .wb-pinned-summary { inset: 8px 8px auto auto; max-inline-size: calc(100% - 16px); }
@container wb-summary (min-width: 1020px) {
  [data-workbench-summary-frame] > .wb-pinned-summary {
    position: relative; inset: auto; flex: none; align-self: flex-start;
    margin: 8px 8px 0 12px;
  }
}
.wb-pinned-summary > [data-summary-group] + [data-summary-group] {
  border-block-start: 1px solid var(--wb-seam);
  margin-block-start: 2px; padding-block-start: 6px;
}
.wb-summary-heading {
  display: flex; align-items: center; gap: 5px; width: 100%; min-block-size: 28px;
  margin: 0; padding: 2px 4px; border: 0; text-align: start; background: transparent;
  color: var(--wb-summary-label); font: inherit;
}
.wb-summary-heading > span {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.wb-summary-heading > :is(small, svg) { flex: none; }
.wb-summary-heading[aria-expanded="true"] > svg { transform: rotate(90deg); }
@media (hover: hover) and (pointer: fine) {
  .wb-summary-heading:not(:hover, :focus-visible, [aria-expanded="true"]) > svg { opacity: 0; }
}
.wb-summary-items { min-inline-size: 0; padding-inline: 4px; }
.wb-summary-empty {
  margin: 3px 0 0; font: inherit; color: var(--wb-summary-label);
}
.wb-pinned-summary small { font-size: 12px; color: var(--dsw-alias-label-secondary, #aaa); white-space: nowrap; }
.wb-agent-icon { inline-size: 16px; text-align: center; font-size: 14px; }
.wb-pinned-summary .wb-summary-row {
  display: grid; grid-template-columns: 16px minmax(0, 1fr) auto; align-items: center;
  width: 100%; min-block-size: 30px; min-inline-size: 0; gap: 8px; padding: 3px 0;
  text-align: start; background: transparent; font-size: 13px; line-height: 18px;
}
.wb-pinned-summary button.wb-summary-row:enabled:hover { background: var(--dsw-alias-background-hover, #8882); }
.wb-summary-row > span:nth-child(2), .wb-summary-task-label > span {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.wb-summary-task-label > :is(span, small) { display: block; }
.wb-summary-task-label > small { line-height: 16px; white-space: normal; overflow-wrap: anywhere; }
.wb-summary-value { display: flex; align-items: center; gap: 4px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.wb-agent-list h3, .wb-agent-list p, .wb-agent-list small, .wb-agent-detail small { color: var(--dsw-alias-label-secondary, #aaa); font-weight: normal; }
.wb-agent-list { width: 100%; height: 100%; overflow: auto; padding: 16px 14px; box-sizing: border-box; font-size: 13px; line-height: 18px; }
.wb-agent-list h3, .wb-agent-list p { font: inherit; margin: 6px 8px; }
.wb-agent-list section + section { margin-top: 20px; }
.wb-agent-list button, .wb-agent-detail header {
  display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 8px;
}
.wb-agent-list button {
  width: 100%; min-block-size: 38px; padding: 6px 8px; border: 0; border-radius: 8px;
  color: inherit; text-align: start; background: transparent; font: inherit;
}
.wb-agent-list button:enabled:hover { cursor: pointer; background: var(--dsw-alias-background-hover, #8882); }
.wb-agent-name, .wb-agent-detail h3 { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.wb-agent-list small, .wb-agent-detail small { font-size: 12px; line-height: 16px; }
.wb-agent-detail { display: flex; flex-direction: column; width: 100%; height: 100%; min-height: 0; }
.wb-agent-detail header, .wb-agent-detail details, .wb-agent-detail > p { padding: 8px 14px; }
.wb-agent-detail header { display: flex; border-bottom: 1px solid #8883; }
.wb-agent-detail h3 { flex: 1; min-inline-size: 0; margin: 0; font-size: 14px; line-height: 20px; font-weight: 500; }
.wb-agent-detail small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-inline-size: 42%; }
.wb-agent-detail details { color: var(--dsw-alias-label-secondary, #aaa); font-size: 13px; line-height: 18px; }
.wb-agent-detail summary { cursor: pointer; }
.wb-agent-detail dl { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 4px 12px; margin: 10px 0 2px; }
.wb-agent-detail dd { margin: 0; overflow-wrap: anywhere; }
.wb-agent-conversation { position: relative; display: flex; flex-direction: column; min-height: 0; flex: 1; overflow: auto; }
.wb-summary-changes b { color: var(--dsw-alias-state-success-primary); font-weight: normal; }
.wb-summary-changes em { color: var(--dsw-alias-state-error-primary); font-style: normal; }
.wb-guide {
  inline-size: min(420px, 100%); margin: auto; box-sizing: border-box; padding: 22px 16px;
  display: grid; gap: 16px; color: var(--dsw-alias-label-primary, #eee);
}
.wb-guide form { display: flex; gap: 6px; }
.wb-guide input { flex: 1; }
.wb-guide-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.wb-guide-grid button { display: grid; gap: 7px; text-align: start; align-content: center; min-block-size: 62px; padding: 10px; }
.wb-guide-results { display: grid; gap: 3px; max-block-size: 220px; overflow: auto; }
.wb-guide-results button { text-align: start; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wb-guide p { margin: 0; font-size: 12px; color: var(--dsw-alias-label-secondary, #aaa); }

html[data-dsh-workbench] { zoom: var(--dsh-workbench-zoom, 1); }
.wb-zoom {
  position: fixed; z-index: 30; inset: calc(var(--dsh-frame-top-clearance, 0px) + 9px) 12px auto auto;
  pointer-events: auto; -webkit-app-region: no-drag;
  display: flex; align-items: center; gap: 5px; padding: 6px 8px;
  background: var(--dsw-specific-sidebar-fill, #252525); color: var(--dsw-alias-label-primary, #eee);
  border: 1px solid var(--dsw-alias-border-primary, #8884); border-radius: 12px; box-shadow: 0 5px 20px #0004;
}
.wb-zoom output { min-inline-size: 3.4em; text-align: center; font-variant-numeric: tabular-nums; font-weight: 600; }
`;
