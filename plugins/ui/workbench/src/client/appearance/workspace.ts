export const workspaceStyles = `
.wb-tree {
  flex: 1;
  block-size: 100%;
  display: flex;
  flex-direction: column;
  min-block-size: 0;
  max-block-size: 100%;
  padding: 4px 0;
  overflow-y: auto;
  box-sizing: border-box;
}
.wb-tree-section { flex: none; }
.wb-tree-section + .wb-tree-section { margin-block-start: 10px; }
.wb-tree-row {
  position: relative;
  display: flex;
  align-items: center;
  min-inline-size: 0;
  border-radius: 7px;
  min-block-size: 31px;
}
.wb-tree-row:hover, .wb-tree-row[data-selected] {
  background: var(--dsw-alias-background-hover, #8882);
}
.wb-tree-row[data-drop="inside"] { box-shadow: inset 0 0 0 1px #4c95f6; }
.wb-tree-row[data-drop="before"] { box-shadow: inset 0 2px #4c95f6; }
.wb-tree-row[data-drop="after"] { box-shadow: inset 0 -2px #4c95f6; }
.wb-tree-label, .wb-tree-action, .wb-tree-show-more {
  appearance: none;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
  -webkit-app-region: no-drag;
  border-radius: 5px;
}
.wb-tree-label {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 7px;
  min-inline-size: 0;
  min-block-size: 31px;
  text-align: start;
  padding: 3px 6px 3px calc(6px + clamp(0px, var(--wb-depth, 0) * 15px, 75px));
}
.wb-tree-label span { min-inline-size: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wb-tree-label svg { flex: none; }
.wb-tree-row[data-wb-kind="section"] .wb-tree-label {
  color: var(--dsw-alias-label-secondary, #999);
  font-size: 12px;
  font-weight: 600;
}
.wb-tree-row[data-wb-kind="section"] [aria-expanded="false"] svg { transform: rotate(-90deg); }
.wb-tree-row[data-wb-kind="project"] [aria-expanded="true"] svg { color: var(--dsw-alias-label-secondary, #999); }
.wb-tree-actions {
  display: flex;
  align-items: center;
  flex: none;
  gap: 1px;
  margin-inline-end: 4px;
}
.wb-tree-action {
  display: grid;
  place-items: center;
  inline-size: 25px;
  block-size: 25px;
  padding: 0;
  color: var(--dsw-alias-label-secondary, #999);
}
.wb-tree-action[data-pinned] { color: var(--dsw-alias-label-primary, #eee); }
.wb-tree-action[data-pinned] svg { fill: currentColor; }
.wb-tree-action[aria-disabled="true"] { cursor: default; }
.wb-tree-action:hover:not([aria-disabled="true"]):hover {
  background: var(--dsw-alias-background-active, #8883);
  color: var(--dsw-alias-label-primary, #eee);
}
.wb-tree :is(button, input):focus-visible, .wb-tree-compact:focus-visible, .wb-tree-view:focus-visible {
  outline: 2px solid var(--dsw-alias-accent-primary, #4c95f6);
  outline-offset: -2px;
}
@media (hover: hover) {
  .wb-tree-row:not(:hover):not(:focus-within) .wb-tree-actions .wb-tree-action:not([data-pinned]) {
    opacity: 0;
    pointer-events: none;
  }
}
.wb-tree-show-more {
  margin-inline-start: calc(6px + clamp(0px, var(--wb-depth, 0) * 15px, 75px));
  padding: 6px 8px;
  color: var(--dsw-alias-label-secondary, #999);
  font-size: 12px;
}
.wb-tree-show-more:hover { background: var(--dsw-alias-background-hover, #8882); }
.wb-tree-running { flex: none; inline-size: 6px; block-size: 6px; border-radius: 50%; background: #4c95f6; }
.wb-tree-error { margin: 4px 6px; font-size: 12px; }
.wb-tree-compact { margin: 6px auto; }
.wb-tree-tail { min-block-size: 30px; flex: 1 0 30px; }
.wb-tree-tail[data-drop] { box-shadow: inset 0 2px #4c95f6; }
.wb-inline-name {
  display: flex; flex-wrap: wrap; gap: 4px;
  padding: 3px 4px 3px calc(4px + clamp(0px, var(--wb-depth, 0) * 15px, 75px));
  margin-block: 2px; flex: none;
}
.wb-inline-name input { flex: 1 1 95px; inline-size: 0; }
.wb-inline-name select { flex: 1 1 80px; max-inline-size: 100%; }
.wb-inline-name .wb-control { margin-inline-start: auto; }
.wb-row-menu, .wb-directory {
  border: 1px solid var(--dsw-alias-border-primary, #8884);
  background: var(--dsw-specific-sidebar-fill, #27282b); color: var(--dsw-alias-label-primary, #eee);
  box-shadow: 0 6px 24px #0006; border-radius: 12px; -webkit-app-region: no-drag;
}
.wb-row-menu {
  position: fixed; z-index: 80; inset: 0 auto auto 0; min-inline-size: 185px;
  max-inline-size: min(300px, 90vw); max-block-size: 80vh; overflow: auto; padding: 5px;
}
.wb-row-menu button {
  display: flex; justify-content: space-between; align-items: center; gap: 10px;
  inline-size: 100%; padding: 6px 9px; border: 0; border-radius: 6px;
  color: inherit; background: transparent; font: inherit; text-align: start; cursor: pointer;
}
.wb-row-menu button:is(:hover, :focus-visible):not(:disabled) { background: var(--dsw-alias-background-hover, #8882); }
.wb-row-menu button:disabled { opacity: .4; cursor: default; }
.wb-row-menu button[data-danger]:enabled { color: #ee897d; }
.wb-directory { inline-size: min(440px, 90vw); padding: 14px; }
.wb-directory::backdrop { background: #0006; }
.wb-directory form, .wb-directory label { display: grid; gap: 7px; }
.wb-directory input { inline-size: 100%; box-sizing: border-box; }
.wb-directory-bar { display: flex; justify-content: end; gap: 6px; }
.wb-directory-entries { display: grid; gap: 2px; max-block-size: 28vh; overflow: auto; }
.wb-directory-entries button { text-align: start; overflow-wrap: anywhere; }
`;
