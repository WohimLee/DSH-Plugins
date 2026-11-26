export const conversationStyles = `
/* Workbench zoom scales this baseline independently of the host's text size. */
html[data-dsh-workbench] [data-conversation-content] {
  --wb-conversation-font: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --wb-conversation-mono: ui-monospace, "SFMono-Regular", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
  --wb-message-size: 14px;
  --wb-message-leading: 22.75px;
}
[data-conversation-content] [data-chat-flow-kind="assistant-step"] {
  --dsw-font-markdown-base: var(--wb-message-size) / var(--wb-message-leading) var(--wb-conversation-font);
  --dsw-font-markdown-h1: 600 calc(var(--wb-message-size) + 5px) / 1.4 var(--wb-conversation-font);
  --dsw-font-markdown-h2: 600 calc(var(--wb-message-size) + 3px) / 1.4 var(--wb-conversation-font);
  --dsw-font-markdown-h3: 600 calc(var(--wb-message-size) + 1px) / 1.4 var(--wb-conversation-font);
  --dsw-font-markdown-h4: 600 var(--wb-message-size) / var(--wb-message-leading) var(--wb-conversation-font);
  --dsw-font-markdown-base-strong: var(--dsw-font-markdown-h4);
  --wb-table-size: 12px;
  --wb-table-leading: 23px;
  --dsw-font-markdown-table: var(--wb-table-size) / var(--wb-table-leading) var(--wb-conversation-font);
  --dsw-font-markdown-table-head: 600 var(--wb-table-size) / var(--wb-table-leading) var(--wb-conversation-font);
}
[data-conversation-content] [data-message-bubble] {
  font-family: var(--wb-conversation-font);
  font-size: var(--wb-message-size);
  line-height: var(--wb-message-leading);
}
[data-conversation-content] [data-chat-flow-kind="assistant-step"] :not(pre) > code {
  font-family: var(--wb-conversation-mono);
  font-size: 12.25px;
}
/* On rc.5 only completed timing labels have nested duration spans. */
html[data-dsh-workbench] [data-conversation-content] [data-turn-process]:is([data-has-duration], :has(> span > span)) {
  font-family: var(--wb-conversation-font);
  font-size: 14px;
}
html[data-dsh-workbench] [data-conversation-content] [data-turn-process] > span > span { font-family: inherit; }
html[data-dsh-workbench] [data-conversation-content] [data-step-process] button[data-process-activity] {
  font-family: var(--wb-conversation-font);
  font-size: 14px;
  font-weight: 430;
}
html[data-dsh-workbench] body[data-ds-dark-theme] [data-conversation-content] [data-message-bubble] {
  --dsw-specific-bubble: var(--dsw-static-blue-900);
}
[data-conversation-content] [data-chat-flow-kind="assistant-step"] p:has(+ p):not([data-markdown-variant="compact"] p) {
  margin-block-end: 0.85em;
}
[data-conversation-content] [data-chat-flow-kind="assistant-step"] p + p:not([data-markdown-variant="compact"] p) {
  margin-block-start: 0.85em;
}

/* The native draft, placeholder and mirror inherit typography from the card. */
@media (pointer: fine) {
  html[data-dsh-workbench] [data-composer-card] {
    font-size: 13.5px;
    line-height: 24px;
  }
}

/* Scope the question layout to the generic host card. The plan-review card
   and normal composer have separate surfaces. */
html[data-dsh-workbench] [data-question-key] > section {
  container: wb-question / inline-size;
}
html[data-dsh-workbench] [data-question-key] > section > header:has(+ [data-question-scroll]) {
  padding-block-start: 16px;
}
html[data-dsh-workbench] [data-question-key] [data-question-scroll] > div:has(> h2:first-child) {
  margin-block-start: 2px;
}
html[data-dsh-workbench] [data-question-key] > section > header h2,
html[data-dsh-workbench] [data-question-key] [data-question-scroll] > div > h2:first-child {
  font-size: 14px;
  line-height: 20px;
}
html[data-dsh-workbench] [data-question-key] [data-option-description] {
  font-size: 14px;
}
html[data-dsh-workbench] [data-question-key] [data-option-row] > button > span:has(> [data-option-line]) {
  column-gap: 8px;
}
html[data-dsh-workbench] [data-question-key] [data-wb-single-question-pager] { display: none; }
@container wb-question (max-width: 512px) {
  html[data-dsh-workbench] [data-question-key] [data-option-row] > button > span:has(> [data-option-line]) {
    flex-direction: column;
    align-items: flex-start;
  }
}
@media (max-width: 720px) {
  html[data-dsh-workbench] [data-question-key] > section > header:has(+ [data-question-scroll]) {
    padding-block-start: 10px;
  }
}

html[data-dsh-workbench] [data-changed-files] {
  /* The single-file header is the trigger inside a native HoverCard. */
  & > button:not([aria-expanded]),
  &[data-single] > span > button {
    height: 65px;

    & > span:nth-child(2) > span:first-child { font-size: 14px; }
    & > span:nth-child(2) > span:last-child { font-size: 13px; line-height: 18px; }
  }

  & > ul button { font-size: 13px; line-height: 22px; }
  & > ul button > span:first-child,
  & > button[aria-expanded] { font-size: 14px; }
}

html[data-dsh-workbench] [data-changes-hover-preview] [data-review-view] {
  font-size: 12px;
}

[data-slot="conversation.session.header"] nav :is(button, span) {
  font-size: 13px;
  line-height: 18px;
}

/* Use the host title, window-drag region and view controls. The rule only
   applies once a Session has views, so the blank composer keeps its layout. */
html[data-dsh-workbench] header[data-window-drag]:has([data-conversation-tabs]) {
  --wb-session-title-height: 36px;
  --wb-session-header-start: 20px;
  --wb-session-header-end: 28px;
  grid-template-rows: minmax(var(--wb-session-title-height), auto) auto;
  min-height: 0;
  padding: 0 var(--wb-session-header-end) 0 var(--wb-session-header-start);
}
html[data-dsh-workbench][data-platform="darwin"] header[data-window-drag]:has([data-conversation-tabs]) {
  --wb-session-title-height: max(36px, var(--dsh-frame-top-clearance, 0px));
}
[data-slot="conversation.session.header"] div:has(> [data-conversation-tabs]) {
  margin-block-start: 0;
  align-items: center;
  gap: 0 20px;
  min-height: 37px;
}
[data-slot="conversation.session.header"] div:has(> [data-conversation-tabs])::before {
  content: '';
  position: absolute;
  inset: 0 calc(-1 * var(--wb-session-header-end)) auto calc(-1 * var(--wb-session-header-start));
  border-block-start: 1px solid var(--dsw-alias-border-l3);
  pointer-events: none;
}
[data-conversation-tabs][role="tablist"] {
  min-height: 37px;
  gap: 0 20px;
}
[data-conversation-tabs] > [role="tab"] {
  min-height: 37px;
  margin-block-start: 0;
  padding-block: 9px;
}
[data-slot="conversation.session.header"] div:has(> [data-conversation-tabs]) button[aria-haspopup="menu"] {
  margin-block-start: 0;
}
/* The preset is a static titled label in this slot. Sibling action buttons retain their chrome. */
[data-slot="conversation.session.header.actions"] > span[title]:has(> svg) {
  background: transparent;
  color: var(--dsw-alias-label-caption);
}
`;
