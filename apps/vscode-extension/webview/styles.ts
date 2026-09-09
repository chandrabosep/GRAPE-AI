/**
 * Styling uses VS Code's own theme variables so the panel belongs in whatever
 * theme the developer already chose, rather than looking like an embedded web
 * page.
 *
 * The sponsored card is the one element that deliberately does NOT blend in. It
 * has its own border, its own background and a permanent label, because a
 * developer must never have to work out whether they are reading the assistant
 * or an advertiser.
 */
export const STYLES = `
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: transparent;
  }
  #root { display: flex; flex-direction: column; height: 100vh; }

  .messages { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 16px; }

  .turn { display: flex; flex-direction: column; gap: 6px; }
  .role {
    font-size: 11px; text-transform: uppercase; letter-spacing: .06em;
    color: var(--vscode-descriptionForeground);
  }
  .bubble { white-space: pre-wrap; word-break: break-word; line-height: 1.55; }
  .bubble pre {
    background: var(--vscode-textCodeBlock-background);
    border: 1px solid var(--vscode-widget-border, transparent);
    border-radius: 4px; padding: 10px; overflow-x: auto; margin: 8px 0;
  }
  .bubble code { font-family: var(--vscode-editor-font-family); font-size: 12px; }

  /* --- sponsored card: intentionally distinct from everything else --- */
  .ad {
    border: 1px solid var(--vscode-focusBorder);
    border-left-width: 3px;
    border-radius: 4px;
    background: var(--vscode-editorWidget-background);
    padding: 12px;
    display: flex; flex-direction: column; gap: 8px;
  }
  .ad-label {
    display: flex; align-items: center; justify-content: space-between;
    font-size: 10px; text-transform: uppercase; letter-spacing: .1em;
    color: var(--vscode-descriptionForeground);
  }
  .ad-headline { font-weight: 600; }
  .ad-body { color: var(--vscode-descriptionForeground); line-height: 1.5; }
  .ad-actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .ad-reasons {
    font-size: 11px; color: var(--vscode-descriptionForeground);
    border-top: 1px solid var(--vscode-widget-border, rgba(128,128,128,.25));
    padding-top: 8px; line-height: 1.6;
  }
  .tag {
    display: inline-block; padding: 1px 6px; margin: 0 4px 4px 0;
    border-radius: 3px; background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground); font-size: 10px;
  }
  .reward { color: var(--vscode-charts-green, #4caf50); font-size: 12px; }

  button {
    font-family: inherit; font-size: 12px; cursor: pointer;
    border-radius: 3px; padding: 4px 10px; border: none;
    background: var(--vscode-button-background); color: var(--vscode-button-foreground);
  }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.link {
    background: none; color: var(--vscode-textLink-foreground);
    padding: 0; text-decoration: none;
  }
  button.link:hover { background: none; text-decoration: underline; }
  button:disabled { opacity: .5; cursor: default; }

  .composer { border-top: 1px solid var(--vscode-widget-border, rgba(128,128,128,.25)); padding: 10px 12px; }
  textarea {
    width: 100%; min-height: 56px; resize: vertical;
    font-family: inherit; font-size: inherit;
    color: var(--vscode-input-foreground);
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 3px; padding: 8px;
  }
  textarea:focus { outline: 1px solid var(--vscode-focusBorder); }

  .footer {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    margin-top: 8px; font-size: 11px; color: var(--vscode-descriptionForeground);
  }
  .empty { padding: 32px 16px; text-align: center; color: var(--vscode-descriptionForeground); line-height: 1.7; }
  .error {
    border-left: 3px solid var(--vscode-errorForeground);
    padding: 8px 10px; color: var(--vscode-errorForeground); font-size: 12px;
  }
`;
