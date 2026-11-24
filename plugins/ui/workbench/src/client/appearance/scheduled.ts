// The rc.5 Schedule page owns the catalog, row activation and detail state.
// Its test anchor and described task buttons distinguish the list from its editor.
const list = 'html[data-dsh-workbench] [data-testid="task-manager-page"] > div:first-child ul:has(> li > button[aria-expanded][aria-describedby])';
const row = `${list} > li > button[aria-expanded][aria-describedby]`;
const text = `${row} > span`;

export const scheduledStyles = `
${list} { gap: 0; }
${row} { min-block-size: 49px; padding-block: 6px; }
${text} > span:first-child { font-size: 14px; line-height: 19px; }
${text} > span[id],
${text} > span[id] :is(span, time) { font-size: 12px; line-height: 16px; }
`;
