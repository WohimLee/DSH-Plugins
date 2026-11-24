// Shared surfaces for the four Workbench destinations. Provider details keep
// their semantic/status colors and the host retains ownership of window controls.
const frame = 'html[data-dsh-workbench] [data-slot="root"] > div';
const managed = `${frame}:is(:not(:has(> div > [data-global-panel])), :has(:is([data-plugin-panel], [data-testid="task-manager-page"], .dsh-model-management)))`;
const darwin = managed.replace('html[data-dsh-workbench]', 'html[data-dsh-workbench][data-platform="darwin"]');
const sidebar = 'div:has(> [data-slot="sidebar"])';
const management = ':is([data-plugin-panel], [data-testid="task-manager-page"], .dsh-model-management)';
const title = ':is([data-plugin-header-part="title"], [data-testid="task-manager-page"] h1, .dsh-model-management h1)';
const nav = ':is(.wb-plugins-navigation, [data-workbench-scheduled-navigation], .dsh-model-management-nav)';

export const chromeStyles = `
html[data-dsh-workbench] {
  --wb-secondary-width: 202px;
  --wb-frame-fill: light-dark(#f0f1f3, #28292c);
  --wb-sidebar-fill: light-dark(#f6f6f7, #222325);
  --wb-canvas: light-dark(#ffffff, #191a1c);
  --wb-seam: light-dark(#dddee2, #303134);
  --wb-frame-seam: light-dark(#dcdde0, #353639);
  --wb-selection: light-dark(#e5e6ea, #353639);
  --wb-hover: light-dark(#eeeff1, #242528);
  --wb-nav-font: var(--dsh-font-family-text, -apple-system), BlinkMacSystemFont, "Segoe UI", sans-serif;
  --wb-page-inset: clamp(18px, 4.2vw, 45px);
}
${managed} {
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
${managed} :is(.wb-plugins-navigation-title, .dsh-model-management-nav > h2, .wb-scheduled-title) {
  font-family: var(--wb-nav-font);
  font-size: 14px;
  line-height: 20px;
  font-weight: 600;
}
${managed} :is(.wb-plugins-navigation > button, .dsh-model-management-nav > button) {
  font-family: var(--wb-nav-font);
  font-size: 13px;
  line-height: 19px;
}
${managed} :is([data-plugin-group] h3, .dsh-model-management-section h2) {
  font-family: var(--wb-nav-font);
  font-size: 14px;
  line-height: 20px;
  font-weight: 600;
}
${managed} :is([data-slot="sidebar.brand.name"] [data-workbench-brand], .wb-source-picker select) {
  font: 600 14px/20px var(--wb-nav-font);
  letter-spacing: normal;
}
${managed} .dsh-model-management-nav > p {
  font-size: 12px;
  line-height: 17px;
  font-weight: 400;
}
${managed} ${management} { background-color: var(--wb-canvas); }
${managed} :is([data-plugin-header-part="title"], [data-plugin-header-part="intro"]):where(h1, div) { margin: 0; }
${managed} div:has(> [data-plugin-header-part="title"]) {
  display: flex; align-items: center; gap: 8px;
}
${managed} [data-plugin-header-part="intro"] > span:first-child { display: none; }
${managed} [data-window-drag]:has([data-workbench-brand]) { height: 40px; }
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
@media (min-width: 824px) {
  ${managed} [data-plugin-panel] { --plugin-page-top-inset: 25px; --plugin-page-inset: var(--wb-page-inset); }
  ${managed} [data-plugin-bar] > header { align-items: center; }
  ${managed} [data-testid="task-manager-page"] > div:first-child > div { scrollbar-gutter: auto; }
  ${managed} .dsh-model-management { grid-template-columns: var(--wb-secondary-width) minmax(0, 1fr); }
  ${managed} .dsh-model-management-body {
    padding: calc(25px + var(--dsh-frame-top-clearance, 0px)) var(--wb-page-inset) 24px;
  }
  ${managed} .dsh-model-management-nav { padding-inline: 8px; }
  ${managed} .dsh-model-management-nav > h2 { margin-inline: 8px; }
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
