export const managementStyles = `
.dsh-model-management {
  --connection-text: var(--dsw-alias-label-primary, CanvasText);
  --connection-muted: var(--dsw-alias-label-secondary, GrayText);
  --connection-border: var(--dsw-alias-border-l1, light-dark(#dfe1e9, #353741));
  --connection-card: light-dark(#f8f9fc, #22242a);
  --connection-accent: light-dark(#4f45a6, #cbc3ff);
  --connection-accent-bg: light-dark(#eae6fb, #342d4c);
  --connection-hover: light-dark(#e6e4ed, #373844);
  height: 100%;
  overflow: auto;
  box-sizing: border-box;
  padding: clamp(24px, 5vw, 56px) clamp(14px, 4vw, 40px);
  color: var(--connection-text);
}
.dsh-model-management-inner {
  display: grid;
  gap: 28px;
  max-width: 900px;
  margin-inline: auto;
  container-type: inline-size;
}
.dsh-model-management :is(h1, h2, h3, p) { margin: 0; }
.dsh-model-management h1 { font-size: clamp(22px, 3.2cqi, 29px); font-weight: 650; line-height: 1.2; letter-spacing: -.02em; }
.dsh-model-management h2 { font-size: 15px; font-weight: 600; }
.dsh-model-management h3 { font-size: 17px; font-weight: 600; }
.dsh-model-management :is(p, summary, li) { font-size: 13px; }
.dsh-model-management-header {
  display: flex; align-items: center; justify-content: space-between; gap: 10px 18px; flex-wrap: wrap;
}
.dsh-model-management-section { display: grid; gap: 12px; }
.dsh-connection-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.dsh-connection-card, .dsh-connection-details, .dsh-connection-grid > section:not(.dsh-connection-card) {
  min-width: 0;
  border: 1px solid var(--connection-border);
  border-radius: 14px;
  background: var(--connection-card);
}
.dsh-connection-card { position: relative; display: flex; flex-direction: column; align-items: flex-start; padding: 18px 18px 0; }
.dsh-connection-card:has(.dsh-connection-open:hover) { border-color: var(--connection-muted); }
.dsh-connection-open::after { content: ''; position: absolute; inset: 0; border-radius: 14px; cursor: pointer; }
.dsh-connection-open:focus-visible::after { outline: 2px solid var(--connection-accent); outline-offset: 2px; }
.dsh-connection-card header { display: flex; align-items: center; gap: 11px; margin-bottom: 16px; }
.dsh-connection-icon { display: block; object-fit: contain; }
.dsh-connection-fallback { display: grid; place-items: center; width: 42px; height: 42px; border-radius: 11px; background: var(--connection-accent-bg); color: var(--connection-accent); }
.dsh-connection-card .dsh-connection-status { display: flex; align-items: center; gap: 6px; font-weight: 550; margin-bottom: 5px; }
.dsh-connection-status[data-tone="neutral"] { color: var(--connection-muted); }
.dsh-connection-status[data-tone="ready"] { color: light-dark(#216744, #93d6b2); }
.dsh-connection-status[data-tone="warning"] { color: light-dark(#80520d, #f0c88a); }
.dsh-connection-card .dsh-connection-description { color: var(--connection-muted); margin-bottom: 17px; }
.dsh-connection-card footer {
  display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 10px;
  width: 100%; padding-block: 10px; margin-top: auto; border-top: 1px solid var(--connection-border);
}
.dsh-connection-footer-label { display: flex; align-items: center; gap: 6px; color: var(--connection-muted); font-size: 12px; }
.dsh-connection-grid > :not(.dsh-connection-card) { grid-column: 1 / -1; order: 1; }
.dsh-connection-actions, .dsh-connection-usage-controls { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; min-width: 0; }
.dsh-connection-usage-controls { position: relative; z-index: 1; }
.dsh-connection-usage-controls select {
  color: inherit; background: var(--connection-card); border: 1px solid var(--connection-border);
  border-radius: 7px; min-height: 32px; padding-inline: 6px; font: inherit; font-size: 12px; max-width: min(100%, 148px);
}
.dsh-connection-details {
  color: inherit; box-sizing: border-box; margin: auto; padding: 0;
  width: min(560px, calc(100vw - 32px)); max-height: calc(100dvh - 32px); overflow: auto;
}
.dsh-connection-details::backdrop { background: rgb(0 0 0 / 38%); }
.dsh-connection-details > section > :is(h2, h3) { padding-inline-end: 34px; }
.dsh-model-management .dsh-connection-close {
  position: absolute; inset-block-start: 9px; inset-inline-end: 10px; justify-content: center; font-size: 19px;
}
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
@container (max-width: 560px) {
  .dsh-connection-grid { grid-template-columns: minmax(0, 1fr); }
}
@media (pointer: coarse) {
  .dsh-model-management :is(button, summary, select) { min-height: 44px; }
}
`;
