/** Stable data-slot anchors are the host's documented dynamic-style seam. */
import { workspaceStyles } from './workspace.js';
import { controlStyles } from './controls.js';
import { chromeStyles } from './chrome.js';
import { pluginSearchStyles } from './plugins.js';
import { scheduledStyles } from './scheduled.js';

const toolFrame = 'html[data-dsh-workbench] [data-slot="root"] > div:has(> div > [data-global-panel])';
const pluginsFrame = `${toolFrame}:not([data-sidebar-drawer]):has([data-workbench-plugins-navigation]):has([data-plugin-panel])`;
const scheduledFrame = `${toolFrame}:not([data-sidebar-drawer]):has([data-workbench-scheduled-navigation]):has([data-testid="task-manager-page"])`;
const pluginGroups = `${pluginsFrame} :is([data-plugin-group="basic"], [data-plugin-group="extensions"], [data-plugin-group="bundles"])`;

const desktopFrame = 'html[data-dsh-workbench] [data-slot="root"] > div:not([data-sidebar-drawer])';
const expandedHome = `${desktopFrame}:has(> [data-side="sidebar"]):not(:has(> div > [data-global-panel]))`;
const sidebarColumn = 'div:has(> [data-slot="sidebar"])';
const settingsSeat = '[data-slot="sidebar.settings"]';
const launcher = '[data-slot="settings.launcher"]';

export const stylesheet = `
html[data-dsh-workbench] { --dsh-workbench-rail: 52px; }
html[data-dsh-workbench] [data-slot="root"] > div {
  margin-inline-start: var(--dsh-workbench-rail);
  width: calc(100% - var(--dsh-workbench-rail));
}
/* Keep the sidebar mounted so switching pages preserves its width and tree state. */
${toolFrame} [data-slot="sidebar"] :is([data-slot="sidebar.workspaces"], [data-slot="sidebar.session.action"], .wb-tree-view, .wb-source-picker),
${toolFrame} [data-slot="sidebar"] [data-window-drag] > :has([data-slot="sidebar.brand.name"]) {
  display: none !important;
}
.wb-plugins-navigation { display: none; }
@media (min-width: 824px) {
  ${expandedHome} {
    grid-template-columns: var(--wb-secondary-width) var(--wb-host-content-tracks) !important;
  }
  ${expandedHome} > ${sidebarColumn} > [data-slot="sidebar"] > div {
    inline-size: 100% !important;
  }
  ${expandedHome} > [data-side="sidebar"] {
    left: var(--wb-secondary-width) !important;
    -webkit-app-region: no-drag;
  }
  ${toolFrame}:not([data-sidebar-drawer]) {
    --dsh-windows-sidebar-width: 0px !important;
  }
  ${toolFrame}:not([data-sidebar-drawer]) > div:has(> [data-global-panel]) {
    grid-column: 1 / 3;
  }
  ${pluginsFrame} > div:has(> [data-global-panel]),
  ${scheduledFrame} > div:has(> [data-global-panel]) {
    margin-inline-start: var(--wb-secondary-width);
  }
  ${pluginGroups} { container: wb-plugins-overview / inline-size; }
  @container wb-plugins-overview (min-width: 680px) {
    ${pluginGroups} > ul {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      align-items: start;
      column-gap: 24px;
    }
  }
  ${pluginsFrame} .wb-plugins-navigation {
    display: flex;
    flex-direction: column;
    gap: 2px;
    position: absolute;
    inset-block: var(--dsh-frame-top-clearance, 0px) 0;
    inset-inline-start: 0;
    inline-size: var(--wb-secondary-width);
    box-sizing: border-box;
    overflow: auto;
    pointer-events: auto;
    border-inline-end: 1px solid var(--dsw-alias-border-primary, #8882);
    background: var(--dsw-specific-sidebar-fill);
    color: var(--dsw-alias-label-primary);
  }
  ${toolFrame}:not([data-sidebar-drawer]) > div:has(> [data-slot="sidebar"]) {
    visibility: hidden; width: 0; height: 0;
  }
  ${toolFrame}:not([data-sidebar-drawer]) ${settingsSeat} { visibility: visible; }
  ${toolFrame}:not([data-sidebar-drawer]) > :is([data-side="sidebar"], [data-shell-leading]) {
    display: none;
  }
  /* Preserve the native account menu, shortcuts, indicators and dialog owners.
     Only its launcher and the list toggle leave the sidebar flow. */
  ${desktopFrame} [data-slot="sidebar"] div:has(> div > ${settingsSeat}):has(> div > [data-slot="sidebar.footer.action"]) {
    display: flex; animation: none;
  }
  ${desktopFrame} ${settingsSeat} > div:has(> ${launcher}) { margin-block: 0; }
  ${desktopFrame} ${launcher}, ${desktopFrame} .wb-tree-view {
    position: fixed; z-index: 21; inset-inline-start: calc((var(--dsh-workbench-rail) - 36px) / 2);
    inline-size: 36px; block-size: 36px; border-radius: 50%; box-sizing: border-box;
  }
  ${desktopFrame} ${launcher} {
    display: grid !important; place-items: stretch; inset-block-end: 7px;
  }
  ${desktopFrame} ${launcher} > [data-inset] { margin: 0; }
  ${desktopFrame} ${launcher} div:has(> [data-slot="settings.launcher.notifications"]) {
    inset-inline: calc(100% + 8px) auto; bottom: 0; width: min(260px, 60vw);
  }
  ${desktopFrame} ${launcher} :is(button[data-signed-out], button:has([data-slot="settings.trigger"])) {
    display: flex; align-items: center; justify-content: center; width: 36px; height: 36px;
    border: 0; padding: 0; gap: 0; border-radius: 50%; background: var(--dsw-alias-background-hover, #8882);
  }
  ${desktopFrame} ${launcher} :is(button[data-signed-out], button:has([data-slot="settings.trigger"])):hover {
    background: var(--dsw-alias-background-active, #8883);
  }
  ${desktopFrame} ${launcher} button[data-signed-out] > span:last-child:not(:first-child),
  ${desktopFrame} [data-slot="settings.trigger"] > span { display: none; }
  ${desktopFrame} .wb-tree-view {
    inset-block-end: 51px; color: var(--dsw-alias-label-secondary, #aaa);
    background: var(--dsw-alias-background-hover, #8882);
  }
  ${desktopFrame}:not([data-sidebar-collapsed]) > div:has(> [data-slot="sidebar"]) {
    border-end-start-radius: 12px;
  }
}
.wb-plugins-navigation button {
  display: flex; align-items: center; gap: 8px; flex: none;
  min-block-size: 31px; padding: 4px 8px; border: 0; border-radius: 7px;
  background: transparent; color: var(--dsw-alias-label-secondary);
  font: inherit; font-size: 13px; text-align: start; cursor: pointer;
  -webkit-app-region: no-drag;
}
.wb-plugins-navigation button svg { flex: none; }
.wb-plugins-navigation button:hover { background: var(--dsw-alias-background-hover, #8882); }
.wb-plugins-navigation button[aria-current] {
  background: var(--dsw-alias-background-active, #8883); color: var(--dsw-alias-label-primary);
}
.wb-plugins-navigation button:focus-visible {
  outline: 2px solid var(--dsw-alias-accent-primary, #4c95f6); outline-offset: -2px;
}
html[data-dsh-workbench] .dsh-workbench-rail {
  position: fixed; inset: var(--dsh-frame-top-clearance, 0px) auto 0 0; width: var(--dsh-workbench-rail);
  box-sizing: border-box; display: flex; flex-direction: column; align-items: center;
  gap: 8px; padding: 8px 6px 95px;
  background: var(--dsw-specific-sidebar-fill, #252525); color: var(--dsw-alias-label-secondary, #999);
  border-inline-end: 1px solid var(--dsw-alias-border-primary, #ffffff12);
  pointer-events: auto; overflow-y: auto; overscroll-behavior: contain;
}
html[data-dsh-workbench] .dsh-workbench-button {
  width: 36px; min-height: 36px; flex-shrink: 0; padding: 0; display: flex;
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
html[data-dsh-workbench] .dsh-workbench-panel-buttons {
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  min-block-size: 0; inline-size: 100%; overflow-y: auto; scrollbar-width: none;
}
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
` + workspaceStyles + controlStyles + scheduledStyles + chromeStyles + pluginSearchStyles;
