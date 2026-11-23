export const managementStyles = `
.dsh-model-management {
  --connection-text: var(--dsw-alias-label-primary, CanvasText);
  --connection-muted: var(--dsw-alias-label-secondary, GrayText);
  --connection-border: light-dark(#e2e3ea, #30323b);
  --connection-canvas: light-dark(#fff, #17181b);
  --connection-nav: light-dark(#f7f7fa, #1c1d22);
  --connection-card: light-dark(#f8f8fb, #202228);
  --connection-accent: light-dark(#56369b, #d0bffa);
  --connection-accent-bg: light-dark(#eeebf9, #2d2840);
  --connection-hover: light-dark(#eeeff3, #2a2c34);
  display: grid;
  grid-template-columns: 164px minmax(0, 1fr);
  height: 100%;
  min-height: 0;
  box-sizing: border-box;
  background: var(--connection-canvas);
  color: var(--connection-text);
}
.dsh-model-management-body {
  min-width: 0; min-height: 0; overflow: auto;
  padding: 25px clamp(15px, 3vw, 31px) 24px;
}
.dsh-model-management-nav {
  box-sizing: border-box; min-width: 0; overflow: auto; padding: 19px 10px;
  border-inline-end: 1px solid var(--connection-border); background: var(--connection-nav);
}
.dsh-model-management .dsh-model-management-nav button {
  width: 100%; justify-content: flex-start; min-height: 35px; gap: 9px;
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
  max-width: 850px;
  margin-inline: auto;
  container-type: inline-size;
}
.dsh-model-management :is(h1, h2, h3, p) { margin: 0; }
.dsh-model-management h1 { font-size: clamp(22px, 3.5cqi, 28px); font-weight: 670; line-height: 1.2; letter-spacing: -.035em; }
.dsh-model-management h2 { font-size: 15px; font-weight: 600; }
.dsh-model-management h3 { font-size: 15px; font-weight: 640; }
.dsh-model-management :is(p, summary, li) { font-size: 13px; }
.dsh-model-management-header {
  display: flex; align-items: center; justify-content: space-between; gap: 10px 18px; flex-wrap: wrap;
}
.dsh-model-management-section { display: grid; gap: 10px; }
.dsh-connection-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 11px; }
.dsh-connection-card, .dsh-connection-method, .dsh-connection-setup {
  min-width: 0;
  border: 1px solid var(--connection-border);
  border-radius: 10px;
  background: var(--connection-card);
}
.dsh-connection-card { position: relative; display: flex; flex-direction: column; align-items: flex-start; padding: 13px 13px 0; }
.dsh-connection-card:has(.dsh-connection-open:hover) { border-color: var(--connection-muted); }
.dsh-connection-open::after { content: ''; position: absolute; inset: 0; border-radius: 10px; cursor: pointer; }
.dsh-connection-open:focus-visible::after { outline: 2px solid var(--connection-accent); outline-offset: 2px; }
.dsh-connection-card header { display: flex; align-items: center; gap: 10px; margin-bottom: 13px; }
.dsh-connection-icon { display: block; object-fit: contain; flex: none; }
.dsh-connection-fallback, .dsh-method-icon {
  display: grid; place-items: center; flex: none; width: 33px; height: 33px;
  border-radius: 9px; background: light-dark(#eee6fc, #362d4a); color: var(--connection-accent);
}
.dsh-connection-fallback[data-provider="codex"] { background: light-dark(#e9e8ff, #33325e); }
.dsh-connection-fallback[data-provider="qoder"] { background: #e6e9ef; color: #272a36; }
.dsh-connection-card .dsh-connection-status { display: flex; align-items: center; gap: 6px; font-weight: 550; margin-bottom: 5px; }
.dsh-connection-status[data-tone="neutral"] { color: var(--connection-muted); }
.dsh-connection-status[data-tone="ready"] { color: light-dark(#216744, #93d6b2); }
.dsh-connection-status[data-tone="warning"] { color: light-dark(#80520d, #f0c88a); }
.dsh-connection-card .dsh-connection-description { color: var(--connection-muted); margin-bottom: 4px; font-size: 12px; }
.dsh-connection-card footer {
  display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 10px;
  width: 100%; padding-block: 9px; margin-top: auto; border-top: 1px solid var(--connection-border);
}
.dsh-connection-card > p:last-of-type { padding-bottom: 9px; }
.dsh-connection-footer-label { display: flex; align-items: center; gap: 6px; color: var(--connection-muted); font-size: 12px; }
.dsh-connection-grid > :not(.dsh-connection-card) { grid-column: 1 / -1; order: 1; }
.dsh-connection-actions, .dsh-connection-usage-controls { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; min-width: 0; }
.dsh-connection-usage-controls { position: relative; z-index: 1; }
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
.dsh-model-legacy-connections { max-width: 850px; margin: 12px auto 0; }
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
.dsh-connection-status svg, .dsh-connection-footer-label svg { flex: none; }
.dsh-model-management button {
  display: inline-flex; align-items: center; gap: 6px; min-height: 32px;
  font: inherit; font-size: 12px; padding: 5px 9px;
  color: inherit; background: transparent; border-radius: 7px; border: 1px solid var(--connection-border);
}
.dsh-model-management button[data-emphasis="true"] { color: var(--connection-accent); background: var(--connection-accent-bg); border-color: transparent; }
.dsh-model-management button:not(:disabled):hover { background: var(--connection-hover); }
.dsh-model-management .dsh-model-management-nav button[aria-current="page"],
.dsh-model-management .dsh-model-management-nav button[aria-current="page"]:hover {
  background: var(--connection-accent-bg); color: var(--connection-accent); font-weight: 600;
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
@container (max-width: 510px) {
  .dsh-connection-grid { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 720px) {
  .dsh-model-management { grid-template-columns: 131px minmax(0, 1fr); }
  .dsh-model-management-nav { padding-inline: 7px; }
}
@media (max-width: 475px) {
  .dsh-model-management { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); }
  .dsh-model-management-nav {
    display: flex; flex-wrap: wrap; gap: 3px; padding: 6px 9px;
    border-inline-end: 0; border-block-end: 1px solid var(--connection-border);
  }
  .dsh-model-management .dsh-model-management-nav button { width: auto; gap: 5px; padding-inline: 7px; }
  .dsh-model-management .dsh-model-management-nav > p { display: none; }
  .dsh-model-management-body { padding-block-start: 16px; }
  .dsh-connection-setup-fields { grid-template-columns: minmax(0, 1fr); }
}
@media (pointer: coarse) {
  .dsh-model-management :is(button, summary, select) { min-height: 44px; }
}
`;
