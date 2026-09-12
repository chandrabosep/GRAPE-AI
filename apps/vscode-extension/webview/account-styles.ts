/**
 * Styling for the account panel.
 *
 * Built on VS Code's own theme variables, so the panel belongs to whatever
 * theme the developer chose, and on the shape the editor's own side panels
 * use: a tiny uppercase label naming a group, then full-bleed rows under it —
 * name on the left, figure hard against the right edge — with a full-width
 * meter wherever a figure has a real ceiling, and a dim caption under the
 * meter saying what the remaining part means.
 *
 * The consequence worth naming: nothing here is a card. Padding is horizontal
 * and shared, so every value in the panel lands on the same right edge and the
 * column can be read straight down without the eye re-finding it per block.
 *
 * Every number is in tabular figures, so a changing balance does not make the
 * text jitter as digits swap width.
 */
export const ACCOUNT_STYLES = `
  * { box-sizing: border-box; }

  html, body { margin: 0; padding: 0; }
  body {
    font-family: var(--vscode-font-family);
    font-size: 12px;
    color: var(--vscode-foreground);
    background: transparent;
    -webkit-font-smoothing: antialiased;
  }

  /* --- sections ------------------------------------------------------------ */

  .section { padding-bottom: 10px; }

  /* The header is a button so the section is keyboard-collapsible, but it must
     not look like one. */
  .section-header {
    width: 100%;
    display: flex; align-items: center; gap: 5px;
    background: none; border: none; cursor: pointer;
    padding: 14px 12px 7px;
    color: var(--vscode-descriptionForeground);
    font-family: inherit;
    font-size: 10.5px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase;
    text-align: left;
  }
  .section-header:hover { color: var(--vscode-foreground); }
  .section-title { flex: 1 1 auto; }

  .chevron {
    flex: 0 0 auto;
    width: 9px; height: 9px;
    margin-left: -2px;
    transition: transform .12s ease-out;
  }
  .chevron.collapsed { transform: rotate(-90deg); }

  /* --- rows ---------------------------------------------------------------- */
  /*
   * The unit the whole panel is made of: what it is, then what it is. The
   * value is allowed to shrink and ellipsis before the label does, because a
   * truncated label loses the row's meaning while a truncated address does not.
   */

  .row {
    display: flex; align-items: baseline; gap: 12px;
    padding: 4px 12px;
    line-height: 1.5;
  }
  .row-label {
    flex: 0 0 auto;
    color: var(--vscode-descriptionForeground);
  }
  .row-value {
    flex: 1 1 auto; min-width: 0;
    text-align: right;
    font-variant-numeric: tabular-nums;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .row-value.strong { font-weight: 600; }

  /* --- meters --------------------------------------------------------------- */

  .meter { padding: 6px 12px 10px; }
  .meter-head {
    display: flex; align-items: baseline; justify-content: space-between; gap: 10px;
  }
  .meter-name { color: var(--vscode-foreground); }
  .meter-figure {
    color: var(--vscode-descriptionForeground);
    font-variant-numeric: tabular-nums;
  }
  .meter-track {
    position: relative;
    height: 4px; margin: 7px 0 5px;
    border-radius: 2px;
    background: var(--vscode-widget-border, rgba(128,128,128,.28));
    overflow: hidden;
  }
  .meter-fill {
    position: absolute; inset: 0 auto 0 0;
    border-radius: 2px;
    background: var(--vscode-progressBar-background, #0a84ff);
    transition: width .25s ease-out;
  }
  .meter-note {
    font-size: 10.5px;
    color: var(--vscode-descriptionForeground);
    opacity: .85;
  }

  /* Reached the threshold: the note becomes the action that spends it. */
  .meter-cta {
    background: none; border: none; padding: 0; cursor: pointer;
    font-family: inherit; font-size: 10.5px;
    color: var(--vscode-textLink-foreground);
  }
  .meter-cta:hover { text-decoration: underline; }

  /* --- section-level actions ------------------------------------------------ */

  /*
   * A command reads as a row too, rather than as a button pinned to a heading:
   * clicking "New session" and clicking a session are the same gesture in the
   * same list, so they are the same shape.
   */
  .command {
    width: 100%;
    display: flex; align-items: center; gap: 8px;
    padding: 6px 12px;
    background: none; border: none; cursor: pointer;
    font-family: inherit; font-size: 12px; text-align: left;
    color: var(--vscode-foreground);
  }
  .command:hover { background: var(--vscode-list-hoverBackground, rgba(128,128,128,.14)); }
  .command svg { flex: 0 0 auto; opacity: .8; }

  .links { display: flex; gap: 2px; padding: 6px 8px 0; }
  .link {
    background: none; border: none; padding: 3px 5px; border-radius: 4px;
    cursor: pointer;
    font-family: inherit; font-size: 11.5px;
    color: var(--vscode-textLink-foreground);
  }
  .link:hover { background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,.16)); }

  /* --- the session toolbar --------------------------------------------------- */

  .toolbar {
    display: flex; align-items: center; gap: 6px;
    padding: 2px 12px 6px;
  }
  .search {
    flex: 1 1 auto; min-width: 0;
    display: flex; align-items: center; gap: 6px;
    padding: 3px 7px;
    border-radius: 4px;
    color: var(--vscode-input-placeholderForeground, var(--vscode-descriptionForeground));
    background: var(--vscode-input-background, rgba(128,128,128,.12));
    border: 1px solid transparent;
  }
  .search:focus-within {
    border-color: var(--vscode-focusBorder, rgba(128,128,128,.5));
  }
  .search svg { flex: 0 0 auto; opacity: .7; }
  .search input {
    flex: 1 1 auto; min-width: 0;
    background: none; border: none; outline: none; padding: 0;
    font-family: inherit; font-size: 11.5px;
    color: var(--vscode-input-foreground, var(--vscode-foreground));
  }
  .search input::placeholder { color: inherit; }

  .count {
    flex: 0 0 auto;
    font-size: 10.5px; font-variant-numeric: tabular-nums;
    color: var(--vscode-descriptionForeground);
  }

  /* --- sessions ------------------------------------------------------------- */

  /*
   * Rows run the full width of the panel rather than sitting inside the body's
   * padding, so the hover highlight reads as "this line of the list" the way
   * the editor's own trees do, and the timestamp lands on the same right edge
   * as every figure above it.
   */
  .session-list { display: flex; flex-direction: column; }

  .session {
    display: flex; align-items: center; gap: 8px;
    padding: 5px 12px;
    cursor: pointer;
  }
  .session:hover { background: var(--vscode-list-hoverBackground, rgba(128,128,128,.14)); }
  .session.active {
    background: var(--vscode-list-inactiveSelectionBackground, rgba(128,128,128,.16));
  }

  /* Marks the open conversation. Reserved on every row so titles align whether
     or not a row carries one. */
  .session-dot {
    flex: 0 0 auto;
    width: 5px; height: 5px; border-radius: 50%;
    background: var(--vscode-charts-blue, #0a84ff);
  }
  .session-dot.hidden { visibility: hidden; }

  .session-name {
    flex: 1 1 auto; min-width: 0;
    line-height: 1.5;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    color: var(--vscode-descriptionForeground);
  }
  .session:hover .session-name { color: var(--vscode-foreground); }
  .session.active .session-name { color: var(--vscode-foreground); }

  .session-age {
    flex: 0 0 auto;
    font-size: 10.5px; font-variant-numeric: tabular-nums;
    color: var(--vscode-descriptionForeground);
  }
  /* The age and the row's actions share the right edge: on hover the controls
     take it, because a timestamp is what you read when you are not acting. */
  .session:hover .session-age,
  .session:focus-within .session-age { display: none; }

  .session-actions { flex: 0 0 auto; display: none; gap: 1px; }
  .session:hover .session-actions,
  .session:focus-within .session-actions { display: flex; }

  .session-action {
    display: inline-flex; align-items: center; justify-content: center;
    width: 20px; height: 18px;
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
    font-family: inherit; font-size: 12px;
    color: var(--vscode-input-foreground);
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-focusBorder, rgba(128,128,128,.5));
    border-radius: 4px;
    padding: 2px 5px;
  }
  .session-rename:focus { outline: none; }

  /* --- empty and signed-out states ------------------------------------------ */

  .empty {
    padding: 2px 12px 6px;
    font-size: 11.5px; color: var(--vscode-descriptionForeground);
  }

  .signin {
    display: block; width: calc(100% - 24px);
    margin: 6px 12px 2px; padding: 5px 12px;
    border: none; border-radius: 4px; cursor: pointer;
    font-family: inherit; font-size: 12px;
    color: var(--vscode-button-foreground);
    background: var(--vscode-button-background);
  }
  .signin:hover { background: var(--vscode-button-hoverBackground); }

  .stale {
    padding: 8px 12px 0;
    font-size: 10.5px; color: var(--vscode-descriptionForeground);
  }
`;
