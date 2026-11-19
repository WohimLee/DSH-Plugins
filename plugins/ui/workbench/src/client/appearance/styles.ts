/** Stable data-slot anchors are the host's documented dynamic-style seam. */
import { workspaceStyles } from './workspace.js';
import { controlStyles } from './controls.js';

const toolFrame = 'html[data-dsh-workbench] [data-slot="root"] > div:has(> div > [data-global-panel])';

export const stylesheet = `
html[data-dsh-workbench] { --dsh-workbench-rail: 56px; }
html[data-dsh-workbench] [data-slot="root"] > div {
  margin-inline-start: var(--dsh-workbench-rail);
  width: calc(100% - var(--dsh-workbench-rail));
}
/* Keep the sidebar mounted so switching pages preserves its width and tree state. */
${toolFrame} [data-slot="sidebar"] :is([data-slot="sidebar.workspaces"], [data-slot="sidebar.session.action"], .wb-tree-view, .wb-source-picker),
${toolFrame} [data-slot="sidebar"] [data-window-drag] > :has([data-slot="sidebar.brand.name"]) {
  display: none !important;
}
@media (min-width: 824px) {
  ${toolFrame}:not([data-sidebar-drawer]) {
    --dsh-windows-sidebar-width: 0px !important;
  }
  ${toolFrame}:not([data-sidebar-drawer]) > div:has(> [data-global-panel]) {
    grid-column: 1 / 3;
  }
  ${toolFrame}:not([data-sidebar-drawer]) > :is(div:has(> [data-slot="sidebar"]), [data-side="sidebar"], [data-shell-leading]) {
    display: none;
  }
}
html[data-dsh-workbench] .dsh-workbench-rail {
  position: fixed; inset: var(--dsh-frame-top-clearance, 0px) auto 0 0; width: var(--dsh-workbench-rail);
  box-sizing: border-box; display: flex; flex-direction: column; align-items: center;
  gap: 8px; padding: 12px 7px;
  background: var(--dsw-specific-sidebar-fill, #252525); color: var(--dsw-alias-label-secondary, #999);
  border-inline-end: 1px solid var(--dsw-alias-border-primary, #ffffff12);
  pointer-events: auto; overflow-y: auto; overscroll-behavior: contain;
}
html[data-dsh-workbench] .dsh-workbench-button {
  width: 40px; min-height: 40px; flex-shrink: 0; padding: 0; display: flex;
  align-items: center; justify-content: center; border: 0; border-radius: 11px;
  background: transparent; color: inherit; cursor: pointer; -webkit-app-region: no-drag;
}
html[data-dsh-workbench] .dsh-workbench-button:hover {
  background: var(--dsw-alias-background-hover, #8882); color: var(--dsw-alias-label-primary, #eee);
}
html[data-dsh-workbench] .dsh-workbench-button[aria-current="page"] {
  background: var(--dsw-alias-background-active, #8883); color: var(--dsw-alias-label-primary, #eee);
}
html[data-dsh-workbench] .dsh-workbench-button:focus-visible { outline: 2px solid var(--dsw-alias-accent-primary, #4c95f6); outline-offset: 2px; }
html[data-dsh-workbench] .dsh-workbench-panel-buttons { display: flex; flex-direction: column; align-items: center; gap: 8px; }
html[data-dsh-workbench] .dsh-workbench-rail-foot { margin-top: auto; padding-top: 24px; display: flex; flex-direction: column; gap: 12px; align-items: center; }
html[data-dsh-workbench] .dsh-workbench-monogram { font: 600 10px/1.4 system-ui, sans-serif; letter-spacing: .06em; opacity: .65; }
html[data-dsh-workbench] [data-workbench-brand] { font: 600 20px/1.4 system-ui, sans-serif; letter-spacing: .01em; }
html[data-dsh-workbench] [data-window-drag]:has(> .wb-source-picker) > :has([data-source-picker]) {
  flex: none; order: -2; pointer-events: none;
}
html[data-dsh-workbench] [data-source-picker] { display: none; }
html[data-dsh-workbench] .wb-source-picker { order: -1; flex: 1; min-width: 0; -webkit-app-region: no-drag; }
html[data-dsh-workbench] .wb-source-picker select {
  max-width: 100%; font: 600 18px/1.4 system-ui, sans-serif; color: inherit; color-scheme: inherit;
  border: 0; border-radius: 7px; background: transparent; padding: 3px 5px; cursor: pointer;
  -webkit-app-region: no-drag;
}
@media (max-width: 823px) {
  html[data-dsh-workbench] { --dsh-workbench-rail: 0px; }
  html[data-dsh-workbench] .dsh-workbench-rail { display: none; }
}
` + workspaceStyles + controlStyles;
