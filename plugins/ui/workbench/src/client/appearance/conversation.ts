export const conversationStyles = `
/* Workbench zoom scales this baseline independently of the host's text size. */
html[data-dsh-workbench] [data-conversation-content] {
  --wb-message-size: 13px;
  --wb-message-leading: 24px;
}
[data-conversation-content] [data-chat-flow-kind="assistant-step"] {
  --dsw-font-markdown-base: var(--wb-message-size) / var(--wb-message-leading) var(--dsw-font-family);
  --dsw-font-markdown-h1: 600 calc(var(--wb-message-size) + 5px) / 1.4 var(--dsw-font-family);
  --dsw-font-markdown-h2: 600 calc(var(--wb-message-size) + 3px) / 1.4 var(--dsw-font-family);
  --dsw-font-markdown-h3: 600 calc(var(--wb-message-size) + 1px) / 1.4 var(--dsw-font-family);
  --dsw-font-markdown-h4: 600 var(--wb-message-size) / var(--wb-message-leading) var(--dsw-font-family);
  --dsw-font-markdown-base-strong: var(--dsw-font-markdown-h4);
  --wb-table-size: 12px;
  --wb-table-leading: 23px;
  --dsw-font-markdown-table: var(--wb-table-size) / var(--wb-table-leading) var(--dsw-font-family);
  --dsw-font-markdown-table-head: 600 var(--wb-table-size) / var(--wb-table-leading) var(--dsw-font-family);
}
[data-conversation-content] [data-message-bubble] {
  font-size: var(--wb-message-size);
  line-height: var(--wb-message-leading);
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
  font-size: 12.5px;
  line-height: 18px;
}

/* Only a populated header has view tabs. Preserve blank-session and drawer geometry. */
@media (min-width: 824px) {
  html[data-dsh-workbench] header[data-window-drag]:has([data-conversation-tabs]) {
    min-height: 64px;
    padding-top: 6px;
  }
  [data-slot="conversation.session.header"] div:has(> [data-conversation-tabs]) {
    margin-top: 6px;
    gap: 10px 16px;
  }
  [data-conversation-tabs][role="tablist"] { min-height: 22px; gap: 12px 24px; }
  [data-conversation-tabs] > [role="tab"] {
    min-height: 28px;
    margin-top: -6px;
    padding-block: 6px;
  }
}
/* The preset is a static titled label in this slot. Sibling action buttons retain their chrome. */
[data-slot="conversation.session.header.actions"] > span[title]:has(> svg) {
  background: transparent;
  color: var(--dsw-alias-label-caption);
}
`;
