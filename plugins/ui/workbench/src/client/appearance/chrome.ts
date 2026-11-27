// Shared surfaces for the four Workbench destinations. Provider details keep
// their semantic/status colors and the host retains ownership of window controls.
const management = ':is([data-plugin-panel], [data-testid="task-manager-page"], .dsh-model-management)';
const frame = '[data-slot="root"] > div';
const globalPanel = '> div > [data-global-panel]';
const managedFrame = `${frame}:is(:not(:has(${globalPanel})), :has(${management}))`;
const managed = `html[data-dsh-workbench] ${managedFrame}`;
const darwinRoot = 'html[data-dsh-workbench][data-platform="darwin"]';
const darwin = `${darwinRoot} ${managedFrame}`;
const blockedFrame = `${frame}:is([data-sidebar-drawer]:not([data-sidebar-collapsed]), [data-rightbar-fullscreen])`;
const dragRoot = `${darwinRoot}:not([data-fullscreen], :has(dialog:modal)) #root:not(:has(${blockedFrame})):is(:not(:has(${frame} ${globalPanel})), :has(${frame} ${management}))`;
const sidebar = 'div:has(> [data-slot="sidebar"])';
const title = ':is([data-plugin-header-part="title"], [data-testid="task-manager-page"] h1, .dsh-model-management h1)';
const nav = ':is(.wb-plugins-navigation, [data-workbench-scheduled-navigation], .dsh-model-management-nav)';
const sidebarTitle = ':is(.wb-plugins-navigation-title, .dsh-model-management-nav > h2, .wb-scheduled-title)';
const homeTitle = ':is([data-slot="sidebar.brand.name"] [data-workbench-brand], .wb-source-picker select)';
const sidebarAction = ':is(.wb-new-section, .wb-plugins-navigation > button, .dsh-model-management-nav > button, .wb-scheduled-new)';
const sidebarGroup = ':is(.wb-tree-row[data-wb-kind="section"] .wb-tree-label, .dsh-model-management-nav > p, .wb-scheduled-group-title, .wb-scheduled-paused summary)';

export const chromeStyles = `
html[data-dsh-workbench] {
  --wb-sidebar-inset: 16px;
  --wb-sidebar-header-height: 44px;
  --wb-sidebar-top: 6px;
  --wb-frame-fill: light-dark(#f0f1f3, #292c2e);
  --wb-sidebar-fill: light-dark(#f6f6f7, #202122);
  --wb-canvas: light-dark(#ffffff, #18191a);
  --wb-summary-fill: light-dark(#f7f7f8, #2b2c2e);
  --wb-seam: light-dark(#dddee2, #333537);
  --wb-frame-seam: light-dark(#dcdde0, #353739);
  --wb-selection: light-dark(#e5e6ea, #303236);
  --wb-hover: light-dark(#eeeff1, #242528);
  --wb-section-label: light-dark(#626569, #93969a);
  --wb-summary-label: light-dark(#585b60, #b0b3b8);
  --wb-nav-font: var(--dsh-font-family-text, -apple-system), BlinkMacSystemFont, "Segoe UI", sans-serif;
  --wb-page-inset: clamp(18px, 4.2vw, 45px);
}
html[data-dsh-workbench][data-platform="darwin"] { --wb-sidebar-top: 0px; }
${managed} {
  --wb-secondary-width: var(--wb-resized-sidebar-width, calc(var(--wb-host-sidebar-track, 280px) + var(--wb-sidebar-inset)));
  --dsw-alias-bg-base: var(--wb-canvas);
  --dsw-alias-border-l3: var(--wb-seam);
  --dsw-specific-sidebar-fill: var(--wb-sidebar-fill);
}
${managed} > ${sidebar} {
  background: var(--wb-sidebar-fill);
  border-inline-end: 1px solid var(--wb-seam);
}
${managed} .dsh-workbench-rail {
  background: var(--wb-frame-fill);
  border-inline-end-color: var(--wb-seam);
}
${managed} :is(.dsh-workbench-button[aria-current="page"], .wb-tree-row[data-selected], ${nav} button:is([aria-current], [aria-pressed="true"])) {
  background: var(--wb-selection);
}
${managed} :is(.wb-tree-row, .dsh-workbench-button, ${nav} button):hover:not(:is([aria-current], [aria-pressed="true"], [data-selected])) {
  background: var(--wb-hover);
}
${managed} ${nav} { font-family: var(--wb-nav-font); border-color: var(--wb-seam); background: var(--wb-sidebar-fill); }
${managed} .dsh-model-management {
  --connection-canvas: var(--wb-canvas);
  --connection-nav: var(--wb-sidebar-fill);
  --connection-border: var(--wb-seam);
}
${managed} .dsh-model-management-nav button[aria-current="page"] {
  background: var(--wb-selection);
  color: var(--connection-text);
  font-weight: 500;
}
${managed} ${title} {
  font-family: var(--wb-nav-font);
  font-size: 21px;
  line-height: 1.3;
  font-weight: 550;
}
${managed} :is(${homeTitle}, ${sidebarTitle}) { font: 600 18px/24px var(--wb-nav-font); letter-spacing: normal; }
${managed} ${sidebarAction},
${managed} .wb-tree-row[data-wb-kind="project"] .wb-tree-label,
${managed} .wb-scheduled-row > span { font: 400 14px/20px var(--wb-nav-font); }
${managed} ${sidebarGroup} { font: 500 14px/20px var(--wb-nav-font); color: var(--wb-section-label); }
${managed} :is([data-plugin-group] h3, .dsh-model-management-section h2) {
  font-family: var(--wb-nav-font);
  font-size: 14px;
  line-height: 20px;
  font-weight: 600;
}
${managed} ${management} { background-color: var(--wb-canvas); }
${managed} :is([data-plugin-header-part="title"], [data-plugin-header-part="intro"]):where(h1, div) { margin: 0; }
${managed} div:has(> [data-plugin-header-part="title"]) {
  display: flex; align-items: center; gap: 8px;
}
${managed} [data-plugin-header-part="intro"] > span:first-child { display: none; }
${managed} [data-window-drag]:has([data-workbench-brand]) span:has(> [data-slot="sidebar.brand.mark"]) { display: none; }
${managed} [data-slot="conversation.session.header"] nav::before {
  content: '';
  flex: none;
  inline-size: 15px;
  block-size: 15px;
  background: currentColor;
  mask: center / contain no-repeat url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.65'%3E%3Cpath d='M3 5h6l2 2h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z'/%3E%3C/svg%3E");
}
.wb-window-caption { display: none; }
/* Electron combines drag rectangles in layout order. A leading pseudo-element
   fills the gaps before the host rows and their no-drag controls are collected. */
${dragRoot}::before {
  content: '';
  position: fixed;
  inset: 0 0 auto;
  block-size: var(--dsh-frame-top-clearance, 48px);
  pointer-events: none;
  -webkit-app-region: drag;
}
/* On management pages controls can scroll into the top strip. They are not
   necessarily inside a native drag row, so preserve their hit targets too. */
${darwin} ${management} :is(button, a[href], input, select, textarea, summary, [contenteditable="true"], [role="button"], [role="link"], [role="tab"]),
${darwin} > :is([data-side="sidebar"], [data-side="rightbar"]) {
  -webkit-app-region: no-drag;
}
@media (min-width: 824px) {
  ${managed} [data-window-drag]:has([data-workbench-brand]) { height: var(--wb-sidebar-header-height); }
  ${darwin}:not([data-sidebar-collapsed]) [data-window-drag] + [data-window-drag]:has([data-workbench-brand]) { margin-block-start: -4px; }
  ${managed} .wb-section-session { padding-block-start: 3px; }
  ${managed} ${nav} { padding: var(--wb-sidebar-top) 12px 8px; }
  ${managed} ${sidebarTitle} {
    display: flex; align-items: center; flex: none;
    block-size: var(--wb-sidebar-header-height); box-sizing: border-box;
    margin: 0 0 3px; padding-inline: 4px;
  }
  ${managed} :is(.wb-plugins-navigation, .dsh-model-management-nav) > :is(.wb-plugins-navigation-title, h2) { margin-block-end: 1px; }
  ${managed} :is(.wb-plugins-navigation > button, .dsh-model-management-nav > button, .wb-scheduled-new) {
    flex: none; box-sizing: border-box; min-block-size: 32px;
    border: 0; border-radius: 7px; padding: 4px 6px; gap: 8px;
  }
  ${managed} .dsh-model-management-nav { display: flex; flex-direction: column; gap: 2px; }
  ${managed} .dsh-model-management-nav > p { margin-inline: 4px; }
  ${managed} :is(.wb-scheduled-group-title, .wb-scheduled-paused summary, .wb-scheduled-row) { padding-inline: 4px; }
  ${managed} [data-plugin-panel] { --plugin-page-top-inset: 25px; --plugin-page-inset: var(--wb-page-inset); }
  ${managed} [data-plugin-bar] > header { align-items: center; }
  ${managed} [data-testid="task-manager-page"] > div:first-child > div { scrollbar-gutter: auto; }
  ${managed} .dsh-model-management { grid-template-columns: var(--wb-secondary-width) minmax(0, 1fr); }
  ${managed} .dsh-model-management-body {
    padding: calc(25px + var(--dsh-frame-top-clearance, 0px)) var(--wb-page-inset) 24px;
  }
  ${darwin} .dsh-model-management-nav { padding-block-start: var(--dsh-frame-top-clearance, 48px); }
  ${darwin}:has(.dsh-model-management) > div:has(> [data-global-panel]) { border-inline-start: 0; }
  ${darwin} .dsh-model-management-nav { border-inline-end: 0; }
  ${darwin} .dsh-model-management-body { border-inline-start: 1px solid var(--wb-seam); }
  ${managed} .wb-window-caption {
    display: grid;
    place-items: center;
    position: absolute;
    inset: 0 0 auto calc(-1 * var(--dsh-workbench-rail));
    block-size: var(--dsh-frame-top-clearance, 0px);
    color: var(--dsw-alias-label-secondary);
    font: 500 11px/16px var(--wb-nav-font);
    pointer-events: none;
  }
  html[data-dsh-workbench]:not([data-platform="darwin"]) .wb-window-caption { display: none; }
}
${darwin},
${darwin} > ${sidebar},
${darwin} ${management},
${darwin} [data-plugin-bar][data-natural]::before,
${darwin} .dsh-model-management-nav,
${darwin} [data-slot="conversation.header"] header[data-window-drag] {
  --wb-top-band: var(--dsh-frame-top-clearance, 48px);
  background-image: linear-gradient(to bottom,
    var(--wb-frame-fill) 0 calc(var(--wb-top-band) - 1px),
    var(--wb-frame-seam) calc(var(--wb-top-band) - 1px) var(--wb-top-band),
    transparent var(--wb-top-band));
}
${darwin} [data-slot="conversation.header"] header[data-window-drag]:not(:has([data-conversation-tabs])) {
  min-block-size: var(--dsh-frame-top-clearance, 48px);
}
html[data-dsh-workbench][data-platform="darwin"] .dsh-workbench-rail::before {
  content: '';
  position: fixed;
  inset: 0 auto auto 0;
  width: var(--dsh-workbench-rail);
  height: var(--dsh-frame-top-clearance, 48px);
  background: var(--wb-frame-fill);
  border-block-end: 1px solid var(--wb-frame-seam);
  box-sizing: border-box;
  pointer-events: none;
}
`;
