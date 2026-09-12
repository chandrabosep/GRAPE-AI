/**
 * Styling for the account panel.
 *
 * Same principle as the chat's stylesheet: VS Code's own theme variables, so
 * the panel belongs to whatever theme the developer chose. What differs is the
 * unit. The chat is a column of prose read top to bottom; this is read in
 * glances, so it is ranked rather than listed — the balance is the size of the
 * thing you came for, the identity and today's spend are captions under it.
 *
 * Every number is in tabular figures, so a changing balance does not make the
 * text jitter as digits swap width.
 *
 * Money is the one thing allowed colour, and only where it is held or earned.
 * Spend stays in the ordinary foreground: a red number next to today's cost, in
 * a tool the developer chose to use, would read as an error rather than a fact.
 */
export const ACCOUNT_STYLES = `
  * { box-sizing: border-box; }

  html, body { margin: 0; padding: 0; }
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: transparent;
    -webkit-font-smoothing: antialiased;
  }

  /* --- sections ------------------------------------------------------------ */

  .section + .section {
    border-top: 1px solid var(--vscode-widget-border, rgba(128,128,128,.22));
  }

  /* The header is a button so the section is keyboard-collapsible, but it must
     not look like one. */
  .section-header {
    width: 100%;
    display: flex; align-items: center; gap: 6px;
    background: none; border: none; cursor: pointer;
    padding: 14px 14px 10px;
    color: var(--vscode-descriptionForeground);
    font-family: inherit;
    font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase;
    text-align: left;
  }
  .section-header:hover { color: var(--vscode-foreground); }
  .section-title { flex: 1 1 auto; }

  .chevron {
    flex: 0 0 auto;
    width: 9px; height: 9px;
    transition: transform .12s ease-out;
  }
  .chevron.collapsed { transform: rotate(-90deg); }

  /* A link-styled action sitting on the section header. */
  .section-action {
    flex: 0 0 auto;
    background: none; border: none; padding: 3px 6px; border-radius: 4px;
    cursor: pointer;
    font-family: inherit; font-size: 11.5px;
    letter-spacing: normal; text-transform: none;
    color: var(--vscode-textLink-foreground);
  }
  .section-action:hover {
    background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,.16));
  }

  .section-body { padding: 0 14px 16px; }

  /* --- identity and balance ------------------------------------------------ */
  /*
   * Hierarchy instead of a stack of equal rows. The previous version gave the
   * balance, the token count, the cost and the request count identical weight,
   * which made the one number worth opening the panel for as quiet as the three
   * that are merely interesting — and it spent a labelled row on each, plus two
   * uppercase group headings, to say four short things.
   */

  .identity {
    font-size: 11.5px;
    color: var(--vscode-descriptionForeground);
    font-variant-numeric: tabular-nums;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }

  .hero {
    display: flex; align-items: baseline; gap: 7px;
    margin: 4px 0 2px;
  }
  .hero-value {
    font-size: 26px; font-weight: 600; line-height: 1.15;
    letter-spacing: -.01em;
    font-variant-numeric: tabular-nums;
    color: var(--vscode-charts-green, #4caf50);
  }
  .hero-caption {
    font-size: 11.5px;
    color: var(--vscode-descriptionForeground);
  }

  /* --- today, on one line --------------------------------------------------- */

  .today {
    display: flex; align-items: baseline; gap: 8px;
    margin-top: 16px;
    font-size: 11.5px;
  }
  .today-label {
    flex: 0 0 auto;
    color: var(--vscode-descriptionForeground);
  }
  .today-value {
    flex: 1 1 auto;
    text-align: right;
    font-variant-numeric: tabular-nums;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }

  /* --- the earnings bar ---------------------------------------------------- */

  .meter { margin: 18px 0 2px; }
  .meter-head {
    display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
    font-size: 12.5px;
  }
  .meter-name { color: var(--vscode-descriptionForeground); }
  .meter-figure { font-variant-numeric: tabular-nums; }
  .meter-track {
    position: relative;
    height: 5px; margin: 9px 0 7px;
    border-radius: 3px;
    background: var(--vscode-widget-border, rgba(128,128,128,.3));
    overflow: hidden;
  }
  .meter-fill {
    position: absolute; inset: 0 auto 0 0;
    border-radius: 3px;
    background: var(--vscode-charts-green, #4caf50);
    transition: width .25s ease-out;
  }
  .meter-note { font-size: 11.5px; color: var(--vscode-descriptionForeground); }

  /* Reached the threshold: the note becomes the action that spends it. */
  .meter-cta {
    background: none; border: none; padding: 0; cursor: pointer;
    font-family: inherit; font-size: 11.5px;
    color: var(--vscode-textLink-foreground);
  }
  .meter-cta:hover { text-decoration: underline; }

  /* --- sessions ------------------------------------------------------------ */

  /*
   * Rows are a list of names, not a table. At one pixel apart and four of
   * padding they read as one block of text with gaps in it — the eye has to do
   * the separating that the layout should have done. A row is given room to be
   * a row, and the title the size of something you are meant to read rather
   * than scan past.
   */
  .session-list { display: flex; flex-direction: column; gap: 2px; }

  .session {
    display: flex; align-items: center; gap: 9px;
    padding: 8px 8px 8px 7px;
    border-radius: 5px;
    cursor: pointer;
  }
  .session:hover { background: var(--vscode-list-hoverBackground, rgba(128,128,128,.14)); }
  .session.active {
    background: var(--vscode-list-activeSelectionBackground, rgba(128,128,128,.2));
    color: var(--vscode-list-activeSelectionForeground, inherit);
  }

  /* Marks the open conversation. Reserved on every row so titles align whether
     or not a row carries one. */
  .session-dot {
    flex: 0 0 auto;
    width: 6px; height: 6px; border-radius: 50%;
    background: var(--vscode-charts-green, #4caf50);
  }
  .session-dot.hidden { visibility: hidden; }

  .session-name {
    flex: 1 1 auto;
    font-size: 13px; line-height: 1.35;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .session.active .session-name { font-weight: 600; }

  .session-age {
    flex: 0 0 auto;
    font-size: 11.5px; font-variant-numeric: tabular-nums;
    color: var(--vscode-descriptionForeground);
  }

  /* Row actions appear on hover. On a touch/keyboard path they are still
     reachable, because focus counts as hover here. */
  .session-actions { flex: 0 0 auto; display: flex; gap: 3px; opacity: 0; }
  .session:hover .session-actions,
  .session:focus-within .session-actions { opacity: 1; }

  .session-action {
    display: inline-flex; align-items: center; justify-content: center;
    width: 20px; height: 20px;
    background: none; border: none; border-radius: 4px;
    padding: 0; cursor: pointer;
    color: var(--vscode-descriptionForeground);
  }
  .session-action:hover {
    background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,.2));
    color: var(--vscode-foreground);
  }

  .session-rename {
    flex: 1 1 auto; min-width: 0;
    font-family: inherit; font-size: 13px;
    color: var(--vscode-input-foreground);
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-focusBorder, rgba(128,128,128,.5));
    border-radius: 4px;
    padding: 3px 6px;
  }
  .session-rename:focus { outline: none; }

  /* --- empty and signed-out states ----------------------------------------- */

  .empty {
    padding: 4px 0 6px;
    font-size: 12.5px; color: var(--vscode-descriptionForeground);
  }

  .signin {
    display: block; width: 100%;
    margin-top: 8px; padding: 7px 12px;
    border: none; border-radius: 5px; cursor: pointer;
    font-family: inherit; font-size: 12.5px;
    color: var(--vscode-button-foreground);
    background: var(--vscode-button-background);
  }
  .signin:hover { background: var(--vscode-button-hoverBackground); }

  .stale {
    margin-top: 12px;
    font-size: 11.5px; color: var(--vscode-descriptionForeground);
  }
`;
