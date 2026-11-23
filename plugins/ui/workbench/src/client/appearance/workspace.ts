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
  font-size: 13.5px;
  line-height: 20px;
  text-align: start;
  padding: 3px 6px 3px calc(6px + clamp(0px, var(--wb-depth, 0) * 15px, 75px));
}
.wb-tree-row:is([data-wb-kind="session"], [data-external-session]) > .wb-tree-label {
  padding-inline-start: calc(6px + clamp(0px, var(--wb-depth, 0) * 15px, 75px) + 16px + 7px);
}
[data-external-branch] > .wb-tree-row .wb-tree-label [aria-hidden] { flex: 0 0 16px; text-align: center; }
.wb-tree-label span { min-inline-size: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wb-archived-title { cursor: default; }
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
    inline-size: 0;
    overflow: clip;
    opacity: 0;
    pointer-events: none;
  }
  .wb-tree-row:not(:hover):not(:focus-within) .wb-tree-actions { gap: 0; }
  .wb-tree-row:not(:hover):not(:focus-within) .wb-tree-actions:not(:has([data-pinned])) { margin-inline-end: 0; }
}
.wb-tree-show-more {
  margin-inline-start: calc(6px + clamp(0px, var(--wb-depth, 0) * 15px, 75px));
  padding: 6px 8px;
  color: var(--dsw-alias-label-secondary, #999);
  font-size: 12px;
}
.wb-tree-show-more:hover { background: var(--dsw-alias-background-hover, #8882); }
.wb-tree[hidden] { display: none; }
.wb-bell { position: relative; }
.wb-bell .wb-status-unread { position: absolute; right: 4px; top: 4px; margin: 0; }
.wb-bell[aria-pressed="true"] { color: var(--dsw-alias-accent-primary, #4c95f6); }
[data-workbench-activity-list] h3 { color: var(--dsw-alias-label-secondary, #999); font-size: 12px; margin: 8px 6px 4px; }
.wb-activity-row { display: block; width: 100%; text-align: start; border: 0; background: transparent; color: inherit; font: inherit; cursor: pointer; padding: 7px 6px; border-radius: 7px; }
.wb-activity-row:hover, .wb-activity-row[aria-current] { background: var(--dsw-alias-background-hover, #8882); }
.wb-activity-line { display: flex; align-items: center; gap: 5px; }
.wb-activity-line > span:first-child, .wb-activity-line small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wb-activity-line > span:first-child { flex: 1; }
.wb-activity-line small { max-width: 40%; }
.wb-activity-line small, .wb-activity-preview { color: var(--dsw-alias-label-secondary, #999); }
.wb-activity-preview { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; font-size: 12px; margin-top: 3px; }
.wb-status-running, .wb-status-unread { margin-inline-end: 6px; }
.wb-status-running { flex: none; width: 11px; height: 11px; border: 1.5px solid currentColor; border-inline-end-color: transparent; border-radius: 50%; animation: wb-spin 850ms linear infinite; }
@keyframes wb-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .wb-status-running { animation: none; } }
.wb-status-unread { flex: none; inline-size: 6px; block-size: 6px; border-radius: 50%; background: #4c95f6; }
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
.wb-inline-name .wb-control { margin-inline-start: auto; }
.wb-row-menu, .wb-edit-project, .wb-directory, .wb-rename-session {
  border: 1px solid var(--dsw-alias-border-primary, #8884);
  background: var(--dsw-specific-sidebar-fill, #27282b); color: var(--dsw-alias-label-primary, #eee);
  box-shadow: 0 6px 24px #0006; border-radius: 12px; -webkit-app-region: no-drag;
}
.wb-row-menu {
  position: fixed; z-index: 80; inset: 0 auto auto 0; min-inline-size: 185px;
  max-inline-size: min(300px, 90vw); max-block-size: 80vh; overflow: auto; padding: 4px 5px;
  font-size: 13px; line-height: 16px;
}
.wb-row-menu button {
  display: flex; justify-content: space-between; align-items: center; gap: 10px;
  inline-size: 100%; min-block-size: 24px; padding: 4px 9px; border: 0; border-radius: 6px;
  color: inherit; background: transparent; font: inherit; text-align: start; cursor: pointer;
}
.wb-row-menu button:is(:hover, :focus-visible):not(:disabled) { background: var(--dsw-alias-background-hover, #8882); }
.wb-row-menu button:disabled { opacity: .4; cursor: default; }
.wb-row-menu button[data-danger]:enabled { color: #ee897d; }
.wb-directory { inline-size: min(440px, 90vw); padding: 14px; }
.wb-directory::backdrop, .wb-rename-session::backdrop { background: #0006; }
.wb-directory form, .wb-directory label { display: grid; gap: 7px; }
.wb-directory input { inline-size: 100%; box-sizing: border-box; }
.wb-directory-bar { display: flex; justify-content: end; gap: 6px; }
.wb-directory-entries { display: grid; gap: 2px; max-block-size: 28vh; overflow: auto; }
.wb-directory-entries button { text-align: start; overflow-wrap: anywhere; }
.wb-rename-session { inline-size: min(360px, 84vw); padding: 18px; }
.wb-rename-session form { display: grid; gap: 12px; }
.wb-rename-session strong { font-size: 1.15em; }
.wb-rename-actions { display: flex; justify-content: end; gap: 8px; }
.wb-rename-actions button[type="submit"]:enabled {
  background: var(--dsw-alias-label-primary, #eee);
  color: var(--dsw-specific-sidebar-fill, #27282b);
}

.wb-row-menu hr { border: 0; border-top: 1px solid #8884; margin: 5px 7px; }
.wb-row-menu button span:first-of-type { flex: 1; }
.wb-edit-project { padding: 0; width: min(500px, 92vw); }
.wb-edit-project::backdrop { background: #0006; }
.wb-edit-project form { padding: 20px; display: grid; gap: 13px; }
.wb-edit-project header, .wb-edit-project footer, .wb-project-name, .wb-folder-list > * { display: flex; align-items: center; gap: 10px; }
.wb-edit-project strong { font-size: 1.28em; flex: 1; }
.wb-edit-project button { font: inherit; color: inherit; background: transparent; border: none; border-radius: 7px; padding: 6px 10px; cursor: pointer; }
.wb-edit-project button:hover { background: #8882; }
.wb-edit-project button:disabled { opacity: .5; }
.wb-project-name, .wb-folder-list { border: 1px solid #8884; border-radius: 9px; }
.wb-project-name { padding: 0 12px; }
.wb-project-name:focus-within { outline: 2px solid #4c95f6; }
.wb-project-name input { flex: 1; min-width: 0; background: transparent; color: inherit; font: inherit; padding: 10px; border: none; border-left: 1px solid #8884; outline: none; }
.wb-edit-project .wb-project-name input:focus-visible { outline: none; box-shadow: none; }
.wb-folder-list { max-height: 36vh; overflow: auto; }
.wb-folder-list > * { padding: 6px 12px; }
.wb-folder-list > * + * { border-top: 1px solid #8883; }
.wb-folder-list span { flex: 1; overflow-wrap: anywhere; }
.wb-folder-row { anchor-name: --wb-folder; anchor-scope: --wb-folder; }
.wb-folder-tooltip {
  display: none; position: fixed; position-anchor: --wb-folder; left: anchor(center); bottom: anchor(top);
  transform: translateX(-50%); z-index: 1; pointer-events: none; width: max-content; max-width: min(32em, 76vw);
  padding: 6px 12px; border: 1px solid var(--dsw-alias-border-primary, #8884); border-radius: 9px;
  background: var(--dsw-specific-sidebar-fill, #27282b); box-shadow: 0 4px 12px #0003; text-align: center;
}
.wb-folder-row:is(:hover, :focus-within) > .wb-folder-tooltip { display: block; }
.wb-folder-list > button { width: 100%; padding: 12px; border-radius: 0; }
.wb-edit-project .wb-remove-local { margin-right: auto; background: #dc454525; color: #ed635d; }
.wb-remove-project footer { justify-content: end; }
.wb-remove-project footer .wb-remove-local { margin-inline-end: 0; }
.wb-remove-project p { margin: 0; }
.wb-remove-project p + p { margin-top: 8px; }
.wb-edit-project .wb-save-project { color: var(--dsw-specific-sidebar-fill, #27282b); background: var(--dsw-alias-label-primary, #eee); }

.wb-create-project {
  box-sizing: border-box; width: min(524px, 92vw); border-radius: 22px; font-size: 13px;
  --wb-create-outline: color-mix(in srgb, var(--dsw-alias-label-primary) 15%, transparent);
  --wb-create-fill: color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent);
  background: color-mix(in srgb, var(--dsw-specific-sidebar-fill) 92%, var(--dsw-alias-label-primary));
}
.wb-create-project form { padding: clamp(14px, 4vw, 20px); gap: 12px; }
.wb-create-project strong { font-size: 20px; }
.wb-create-project header button, .wb-create-project footer button[type="button"] { color: var(--dsw-alias-label-secondary); }
.wb-create-project .wb-project-name, .wb-create-project .wb-folder-empty, .wb-create-project .wb-folder-list {
  border: 1px solid var(--wb-create-outline); border-radius: 10px;
}
.wb-create-project .wb-project-name:focus-within { outline: 1px solid var(--dsw-alias-state-business-primary); outline-offset: -1px; }
.wb-create-project .wb-project-name input { border-inline-start: 1px solid var(--wb-create-outline); }
.wb-create-project .wb-project-name input::placeholder { color: var(--dsw-alias-label-secondary); }
.wb-create-project .wb-project-sources { margin-block: 1px -4px; }
.wb-folder-empty { min-block-size: 104px; display: grid; place-content: center; justify-items: center; gap: 10px; padding: 10px; box-sizing: border-box; text-align: center; }
.wb-folder-empty > span { color: var(--dsw-alias-label-secondary); }
.wb-create-project .wb-folder-list > * { box-sizing: border-box; min-block-size: 48px; }
.wb-create-project .wb-folder-list > * + * { border-block-start: 1px solid var(--wb-create-outline); }
.wb-create-project .wb-folder-list svg { color: var(--dsw-alias-label-secondary); flex: none; }
.wb-create-project .wb-folder-row > span { min-inline-size: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wb-folder-primary-slot { flex: 0 0 100px; display: flex; justify-content: end; }
.wb-create-project .wb-folder-primary {
  padding: 5px 8px; white-space: nowrap;
  border: 1px solid transparent; background: var(--wb-create-fill); border-radius: 10px;
}
.wb-create-project .wb-folder-primary[data-primary] {
  border-color: var(--wb-create-outline); background: transparent;
  color: var(--dsw-alias-label-secondary); cursor: default;
}
@media (hover: hover) and (pointer: fine) {
  .wb-create-project .wb-folder-row:not(:hover, :has(:focus-visible)) .wb-folder-primary:not([data-primary]) {
    opacity: 0; pointer-events: none;
  }
}
.wb-create-project .wb-folder-empty button {
  display: flex; align-items: center; gap: 6px; padding: 5px 10px; border-radius: 999px;
  background: var(--wb-create-fill);
}
.wb-create-project button:enabled:hover { background: var(--dsw-alias-background-active); }
.wb-create-project footer { justify-content: flex-end; flex-wrap: wrap; margin-block-start: 18px; }
.wb-create-project footer button { padding: 8px 16px; border-radius: 10px; }
.wb-create-project .wb-save-project:enabled:hover { background: var(--dsw-alias-label-primary); opacity: .88; }
`;
