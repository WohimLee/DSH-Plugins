export const controlStyles = `
.wb-control {
  appearance: none; border: 1px solid transparent; border-radius: 7px; padding: 5px 8px;
  font: inherit; color: inherit; background: var(--dsw-alias-background-hover, #8882);
  cursor: pointer; -webkit-app-region: no-drag;
}
.wb-control:hover, .wb-control[aria-pressed="true"] { background: var(--dsw-alias-background-active, #8883); }
.wb-control:disabled { opacity: .45; cursor: default; }
.wb-control:focus-visible { outline: 2px solid var(--dsw-alias-accent-primary, #4c95f6); }
.wb-section-action { display: flex; align-items: stretch; gap: 6px; inline-size: 100%; }
.wb-section-session { flex: 1; min-inline-size: 0; }
.wb-section-session button { inline-size: 100%; }
.wb-section-trigger { display: grid; place-items: center; flex: none; }
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
.wb-summary-path { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--dsw-alias-label-secondary, #aaa); }
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
