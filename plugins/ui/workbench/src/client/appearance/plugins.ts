export const pluginSearchStyles = `
html[data-dsh-workbench] [data-plugin-body] > [data-workbench-plugin-search] {
  margin-block: -15px -8px;
  color: var(--dsw-alias-label-secondary);
  -webkit-app-region: no-drag;
}
.wb-plugin-search-field {
  display: flex; align-items: center; gap: 8px; padding-inline: 10px;
  min-block-size: 34px; box-sizing: border-box; border-radius: 7px;
  border: 1px solid var(--dsw-alias-border-primary, #8884);
}
.wb-plugin-search-field:focus-within {
  outline: 1px solid var(--dsw-alias-accent-primary, #4c95f6);
}
.wb-plugin-search-field svg { flex: none; }
.wb-plugin-search-field input {
  flex: 1; min-inline-size: 0; padding: 6px 0; border: 0; outline: none;
  background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px;
}
.wb-plugin-search-field input::placeholder { color: var(--dsw-alias-label-secondary); }
[data-workbench-plugin-search] p { margin-block: 12px 0; font-size: 13px; }
html[data-dsh-workbench] [data-plugin-panel] [data-workbench-plugin-filtered] { display: none !important; }
`;
