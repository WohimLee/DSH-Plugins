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
/* Style the native session trigger and preserve its shortcut hint and event handling. */
html[data-dsh-workbench] .wb-section-session button:has(> span > span > svg) {
  width: 100%; height: 32px; justify-content: flex-start; padding: 4px 6px; border: 0;
  background: transparent; font-weight: 400;
}
html[data-dsh-workbench] .wb-section-session button > span > span:has(> svg) { justify-content: flex-start; gap: 8px; }
html[data-dsh-workbench] .wb-section-session button:has(> span > span > svg):hover {
  background: var(--dsw-alias-background-hover, #8882);
}
.wb-section-action { display: flex; align-items: center; gap: 2px; flex: none; }
.wb-section-trigger { display: grid; place-items: center; width: 28px; height: 28px; padding: 0; background: transparent; color: var(--dsw-alias-label-secondary, #999); }
html[data-dsh-workbench] [data-window-drag]:has([data-workbench-brand]) { height: 48px; gap: 4px; }
html[data-dsh-workbench] [data-slot="sidebar.brand.name"] [data-workbench-brand] { font-size: 18px; }
.wb-inline-name input, .wb-directory input, .wb-rename-session input, .wb-guide input {
  border: 1px solid var(--dsw-alias-border-primary, #8884); border-radius: 7px; color: inherit;
  background: var(--dsw-alias-background-hover, #8882); padding: 7px 9px; font: inherit; min-inline-size: 0;
}
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
.wb-header-controls .wb-control { display: inline-grid; place-items: center; background: transparent; }
.wb-header-controls .wb-control:hover, .wb-header-controls .wb-control[aria-pressed="true"] {
  background: var(--dsw-alias-background-active, #8883);
}
.wb-pinned-summary {
  position: absolute; z-index: 5; inset: calc(100% + 8px) 0 auto auto;
  display: grid; gap: 9px; inline-size: min(265px, 60vw); padding: 13px;
  color: var(--dsw-alias-label-primary, #eee); background: var(--dsw-specific-sidebar-fill, #252525);
  border: 1px solid var(--dsw-alias-border-primary, #8884); border-radius: 12px; box-shadow: 0 6px 22px #0004;
  -webkit-app-region: no-drag;
}
.wb-pinned-summary { max-height: min(70vh, 600px); overflow: auto; }
.wb-pinned-summary section { display: grid; gap: 6px; border-top: 1px solid #8883; padding-top: 10px; }
.wb-pinned-summary small, .wb-agent-list h3, .wb-agent-list p, .wb-agent-list small, .wb-agent-detail small { color: var(--dsw-alias-label-secondary, #aaa); font-weight: normal; }
.wb-pinned-summary .wb-control { justify-items: start; text-align: start; overflow-wrap: anywhere; }
.wb-pinned-summary .wb-summary-agents { gap: 9px; }
.wb-summary-agents span span { margin-right: 4px; }
.wb-agent-list { width: 100%; height: 100%; overflow: auto; padding: 18px; box-sizing: border-box; }
.wb-agent-list h3, .wb-agent-list p { font-size: inherit; margin: 8px; }
.wb-agent-list section + section { margin-top: 26px; }
.wb-agent-list button, .wb-agent-detail header { display: flex; align-items: center; gap: 10px; }
.wb-agent-list button { width: 100%; padding: 9px; border: 0; border-radius: 8px; color: inherit; text-align: start; background: transparent; font: inherit; }
.wb-agent-list button:enabled:hover { cursor: pointer; background: #8882; }
.wb-agent-list small, .wb-agent-detail small { margin-left: auto; }
.wb-agent-detail { display: flex; flex-direction: column; width: 100%; height: 100%; min-height: 0; }
.wb-agent-detail header, .wb-agent-detail details { padding: 10px 14px; }
.wb-agent-detail header { border-bottom: 1px solid #8883; }
.wb-agent-conversation { position: relative; display: flex; flex-direction: column; min-height: 0; flex: 1; overflow: auto; }
.wb-header-controls .wb-summary-changes { display: flex; justify-content: space-between; }
.wb-summary-changes b { color: #49ae78; font-weight: normal; }
.wb-summary-changes em { color: #e36565; font-style: normal; }
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
