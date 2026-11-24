export const managementStyles = `
.dsh-model-management {
  --connection-text: var(--dsw-alias-label-primary, CanvasText);
  --connection-muted: var(--dsw-alias-label-secondary, GrayText);
  --connection-border: var(--dsw-alias-border-primary, light-dark(#e2e3e5, #303134));
  --connection-canvas: light-dark(#fff, #191a1c);
  --connection-nav: var(--dsw-specific-sidebar-fill, light-dark(#f7f7f8, #222325));
  --connection-card: light-dark(#f8f8fb, #202228);
  --connection-accent: light-dark(#56369b, #d0bffa);
  --connection-accent-bg: light-dark(#eeebf9, #2d2840);
  --connection-hover: var(--dsw-alias-background-hover, light-dark(#eeeff0, #252629));
  display: grid;
  grid-template-columns: 164px minmax(0, 1fr);
  height: 100%;
  min-height: 0;
  box-sizing: border-box;
  background: var(--connection-canvas);
  color: var(--connection-text);
}
html[data-platform="darwin"] .dsh-model-management {
  --model-page-clearance: var(--dsh-frame-top-clearance, 0px);
}
.dsh-model-management-body {
  min-width: 0; min-height: 0; overflow: auto;
  padding: calc(28px + var(--model-page-clearance, 0px)) clamp(24px, 4vw, 48px) 24px;
}
.dsh-model-management-nav {
  box-sizing: border-box; min-width: 0; overflow: auto;
  padding: calc(8px + var(--model-page-clearance, 0px)) 10px 8px;
  border-inline-end: 1px solid var(--connection-border); background: var(--connection-nav);
}
.dsh-model-management .dsh-model-management-nav button {
  width: 100%; justify-content: flex-start; min-height: 31px; gap: 9px;
  padding: 6px 9px; border-color: transparent; color: var(--connection-muted); font-size: 13px;
  text-align: start; overflow-wrap: anywhere;
}
.dsh-model-management-nav button svg { flex: none; }
.dsh-model-management .dsh-model-management-nav > p {
  margin: 19px 9px 5px; font-size: 11px; font-weight: 550; color: var(--connection-muted);
}
.dsh-model-management-inner {
  display: grid;
  gap: 23px;
  max-width: 960px;
  margin-inline: auto;
}
.dsh-model-management :is(h1, h2, h3, p) { margin: 0; }
.dsh-model-management h1 { font-size: 20px; font-weight: 500; line-height: 28px; letter-spacing: normal; }
.dsh-model-management h2 { font-size: 15px; font-weight: 600; }
.dsh-model-management h3 { font-size: 15px; font-weight: 600; }
.dsh-model-management :is(p, summary, li) { font-size: 13px; }
.dsh-model-management-nav > h2 { margin: 0 9px 10px; font-size: 14px; line-height: 20px; }
.dsh-model-management-header {
  display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap;
}
.dsh-model-management-section { display: grid; gap: 10px; }
.dsh-connection-list { border-block-start: 1px solid var(--connection-border); }
.dsh-connection-row {
  position: relative; display: grid; align-items: center;
  grid-template-columns: minmax(0, 1fr) fit-content(42%) auto; gap: 10px;
  min-height: 60px; box-sizing: border-box; padding: 8px 6px;
  border-block-end: 1px solid var(--connection-border);
}
.dsh-connection-row:hover { background: var(--connection-hover); }
.dsh-connection-row header { display: flex; align-items: center; gap: 10px; overflow-wrap: anywhere; }
.dsh-connection-row h3 { font-size: 13px; line-height: 19px; }
.dsh-connection-row .dsh-connection-description { color: var(--connection-muted); font-size: 12px; line-height: 17px; }
.dsh-connection-row .dsh-connection-status {
  display: flex; align-items: center; gap: 5px; justify-self: end;
  font-size: 12px; line-height: 17px; overflow-wrap: anywhere;
}
.dsh-model-management .dsh-connection-open {
  color: var(--connection-muted); border: 0; padding: 0;
}
.dsh-connection-open::after { content: ''; position: absolute; inset: 0; cursor: pointer; }
.dsh-connection-open:focus-visible { outline: none; }
.dsh-connection-open:focus-visible::after {
  outline: 2px solid var(--dsw-alias-accent-primary, var(--connection-accent)); outline-offset: -2px;
}
.dsh-connection-method, .dsh-connection-setup {
  min-width: 0;
  border: 1px solid var(--connection-border);
  border-radius: 10px;
  background: var(--connection-card);
}
.dsh-connection-icon { display: block; object-fit: contain; flex: none; }
.dsh-connection-fallback, .dsh-method-icon {
  display: grid; place-items: center; flex: none; width: 33px; height: 33px;
  border-radius: 9px; background: light-dark(#eee6fc, #362d4a); color: var(--connection-accent);
}
.dsh-connection-fallback[data-provider="codex"] { background: light-dark(#e9e8ff, #33325e); }
.dsh-connection-fallback[data-provider="qoder"] { background: #e6e9ef; color: #272a36; }
.dsh-connection-row .dsh-connection-icon {
  width: 31px; height: 31px; box-sizing: border-box;
}
.dsh-connection-row .dsh-connection-fallback {
  background: var(--connection-card); color: var(--connection-muted); border: 1px solid var(--connection-border);
}
.dsh-connection-status[data-tone="neutral"] { color: var(--connection-muted); }
.dsh-connection-status[data-tone="ready"] { color: light-dark(#216744, #93d6b2); }
.dsh-connection-status[data-tone="warning"] { color: light-dark(#80520d, #f0c88a); }
.dsh-connection-actions, .dsh-connection-usage-controls { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; min-width: 0; }
.dsh-connection-usage-summary {
  display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 8px 12px;
  padding: 6px 8px; border-block: 1px solid var(--connection-border);
}
.dsh-model-catalog-jump { justify-self: start; }
.dsh-connection-usage-controls select {
  color: inherit; background: var(--connection-card); border: 1px solid var(--connection-border);
  border-radius: 7px; min-height: 32px; padding-inline: 6px; font: inherit; font-size: 12px; max-width: min(100%, 148px);
}
.dsh-provider-header > div, .dsh-method-heading { display: flex; align-items: center; gap: 10px; min-width: 0; }
.dsh-provider-header .dsh-connection-icon { width: 43px; height: 43px; }
.dsh-provider-header .dsh-connection-icon svg { width: 21px; height: 21px; }
.dsh-provider-header p, .dsh-method-heading p { margin-top: 3px; color: var(--connection-muted); }
.dsh-method-heading p { font-size: 12px; }
.dsh-connection-method-stack { display: grid; gap: 13px; }
.dsh-connection-method { display: grid; gap: 12px; padding: 14px; }
.dsh-connection-method > header { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.dsh-connection-setup { display: grid; gap: 15px; max-width: 620px; padding: 17px; }
.dsh-connection-setup-fields { display: grid; gap: 12px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
.dsh-connection-setup :is(footer, .dsh-connection-setup-method) { border-top: 1px solid var(--connection-border); padding-top: 14px; }
.dsh-connection-setup footer { display: flex; justify-content: flex-end; }
.dsh-connection-setup-method, .dsh-connection-method-content, .dsh-connection-form { display: grid; gap: 9px; justify-items: start; }
.dsh-connection-setup-method > *, .dsh-connection-method-content, .dsh-connection-form { min-width: 0; width: 100%; }
.dsh-connection-setup label, .dsh-connection-form label { display: grid; gap: 5px; font-size: 13px; font-weight: 530; width: 100%; }
.dsh-connection-setup select, .dsh-connection-form input {
  box-sizing: border-box; width: 100%; min-height: 34px; color: inherit; font: inherit;
  background: var(--connection-canvas); border: 1px solid var(--connection-border); border-radius: 6px; padding: 5px 8px;
}
.dsh-connection-form > div { display: flex; gap: 8px; flex-wrap: wrap; }
.dsh-desktop-detection, .dsh-connection-accounts { box-sizing: border-box; width: 100%; margin: 0; }
.dsh-desktop-detection { padding: 2px 10px; border: 1px solid var(--connection-border); border-radius: 7px; background: var(--connection-nav); }
.dsh-desktop-detection > div, .dsh-connection-accounts > li {
  display: flex; align-items: center; justify-content: space-between; gap: 6px 12px; flex-wrap: wrap; min-height: 34px;
}
.dsh-desktop-detection > div + div, .dsh-connection-accounts > li + li { border-top: 1px solid var(--connection-border); }
.dsh-desktop-detection dt, .dsh-desktop-detection dd { margin: 0; font-size: 13px; }
.dsh-desktop-detection dd { display: flex; align-items: center; gap: 6px; }
.dsh-connection-accounts { list-style: none; padding: 0; border-top: 1px solid var(--connection-border); }
.dsh-connection-accounts li { padding-block: 6px; overflow-wrap: anywhere; }
.dsh-connection-accounts li p { color: var(--connection-muted); font-size: 12px; }
.dsh-model-legacy-connections { max-width: 960px; margin: 12px auto 0; }
.dsh-connection-usage { position: relative; }
.dsh-connection-usage:is(:hover, :focus-within) { z-index: 2; }
.dsh-model-management .dsh-connection-usage-button { border-color: transparent; padding: 3px; }
.dsh-connection-usage-button svg { width: 20px; height: 20px; display: block; transform: rotate(-90deg); }
.dsh-connection-usage-button circle { fill: none; stroke-width: 2; }
.dsh-connection-usage-track { stroke: var(--connection-border); }
.dsh-connection-usage-button[data-remaining] .dsh-connection-usage-track { stroke: var(--connection-muted); opacity: .4; }
.dsh-connection-usage-arc { stroke: var(--connection-accent); stroke-linecap: round; }
.dsh-connection-usage-tooltip {
  display: none; position: absolute; z-index: 1; inset-block-end: 100%; inset-inline-end: 0;
  width: max-content; max-width: min(252px, 72vw); padding: 7px 9px; border-radius: 7px;
  color: var(--connection-text); background: var(--connection-card); border: 1px solid var(--connection-border);
  box-shadow: var(--dsw-elevation-prominent); font-size: 12px; overflow-wrap: anywhere;
}
.dsh-connection-usage:is(:hover, :focus-within) .dsh-connection-usage-tooltip { display: grid; gap: 3px; }
.dsh-connection-text-details { display: grid; gap: 8px; padding: 16px 18px; overflow-wrap: anywhere; }
.dsh-connection-status svg { flex: none; }
.dsh-model-management button {
  display: inline-flex; align-items: center; gap: 6px; min-height: 32px;
  font: inherit; font-size: 12px; padding: 5px 9px;
  color: inherit; background: transparent; border-radius: 7px; border: 1px solid var(--connection-border);
}
.dsh-model-management button[data-emphasis="true"] { color: var(--connection-accent); background: var(--connection-accent-bg); border-color: transparent; }
.dsh-model-management button:not(:disabled):hover { background: var(--connection-hover); }
.dsh-model-management .dsh-model-management-nav button[aria-current="page"],
.dsh-model-management .dsh-model-management-nav button[aria-current="page"]:hover {
  background: var(--dsw-alias-background-active, light-dark(#e6e7e9, #353639));
  color: var(--connection-text);
}
.dsh-model-management button:disabled { opacity: .6; }
.dsh-model-management input {
  max-width: 100%; box-sizing: border-box; color: inherit; font: inherit; padding: 4px 6px; background: transparent;
  border: 1px solid var(--connection-border); border-radius: 6px;
}
.dsh-model-management fieldset { min-width: 0; margin-inline: 0; }
.dsh-model-management-catalog { border-top: 1px solid var(--connection-border); }
.dsh-model-management-catalog details { border-bottom: 1px solid var(--connection-border); }
.dsh-model-management-catalog summary { display: flex; align-items: center; gap: 8px; min-height: 41px; cursor: pointer; list-style: none; }
.dsh-model-management-catalog summary::-webkit-details-marker { display: none; }
.dsh-model-management-catalog summary span:last-of-type { margin-inline-start: auto; }
.dsh-model-management-catalog summary :is(svg, span:last-of-type) { color: var(--connection-muted); }
.dsh-model-management-catalog details[open] summary svg:last-child { transform: rotate(180deg); }
.dsh-model-management-route { padding: 0 23px 9px; }
.dsh-model-management-route ul { margin: 4px 0 0; padding-inline-start: 18px; }
.dsh-model-management-route li { padding-block: 5px; overflow-wrap: anywhere; }
.dsh-model-management-route li p { margin-top: 3px; white-space: pre-line; color: var(--connection-muted); }
@media (min-width: 824px) {
  .dsh-model-management { grid-template-columns: 283.5px minmax(0, 1fr); }
}
@media (max-width: 767px) {
  .dsh-model-management-body { padding-inline: 20px; }
}
@media (max-width: 720px) {
  .dsh-model-management { grid-template-columns: 131px minmax(0, 1fr); }
  .dsh-model-management-nav { padding-inline: 7px; }
}
@media (max-width: 475px) {
  .dsh-model-management { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); }
  .dsh-model-management-nav {
    display: flex; flex-wrap: wrap; gap: 3px; padding-inline: 9px; padding-block-end: 6px;
    border-inline-end: 0; border-block-end: 1px solid var(--connection-border);
  }
  .dsh-model-management .dsh-model-management-nav button { width: auto; gap: 5px; padding-inline: 7px; }
  .dsh-model-management-nav > h2 { flex-basis: 100%; margin: 0 7px 3px; }
  .dsh-model-management .dsh-model-management-nav > p { display: none; }
  .dsh-model-management-body { padding-block-start: 16px; }
  .dsh-connection-setup-fields { grid-template-columns: minmax(0, 1fr); }
  .dsh-connection-row, .dsh-connection-row header { gap: 6px; }
}
@media (pointer: coarse) {
  .dsh-model-management :is(button, summary, select),
  .dsh-model-management .dsh-model-management-nav button { min-height: 44px; }
}
`;
