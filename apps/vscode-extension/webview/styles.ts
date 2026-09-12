/**
 * Styling uses VS Code's own theme variables so the panel belongs in whatever
 * theme the developer already chose, rather than looking like an embedded web
 * page. Everything else is spacing and rhythm: a sidebar is narrow and read in
 * glances, so line length, weight and vertical space carry the hierarchy
 * instead of colour.
 *
 * The sponsored card is the one element that deliberately does NOT blend in. It
 * sits below a rule, in its own bordered surface, carrying an advertiser name
 * and a permanent `Ad` badge, because a developer must never have to work out
 * whether they are reading the assistant or an advertiser.
 */
export const STYLES = `
  * { box-sizing: border-box; }

  /* VS Code injects 20px of horizontal body padding into every webview, which
     in a narrow sidebar eats a sixth of the width and leaves the topbar rule
     and the composer floating in gutters. The panel draws its own edges, so
     take the full width back and let each section own its padding. */
  html, body {
    height: 100%;
    margin: 0;
    padding: 0;
    overflow: hidden;
  }
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: transparent;
    -webkit-font-smoothing: antialiased;
  }
  #root { display: flex; flex-direction: column; height: 100%; }

  @keyframes rise {
    from { opacity: 0; transform: translateY(4px); }
    to { opacity: 1; transform: none; }
  }
  @keyframes blink { 50% { opacity: 0; } }
  @keyframes pulse { 0%, 100% { opacity: .35; } 50% { opacity: 1; } }

  /* --- top bar --- */
  .topbar {
    flex: 0 0 auto;
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    padding: 7px 12px;
    border-bottom: 1px solid var(--vscode-widget-border, rgba(128,128,128,.22));
  }
  .brand {
    display: inline-flex; align-items: center; gap: 7px;
    font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase;
    color: var(--vscode-descriptionForeground);
  }
  .brand-dot {
    width: 7px; height: 7px; border-radius: 50%;
    background: var(--vscode-charts-green, #4caf50);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--vscode-charts-green, #4caf50) 18%, transparent);
  }
  .brand-dot.large { width: 10px; height: 10px; margin-bottom: 4px; }
  .topbar-actions { display: flex; align-items: center; gap: 4px; }
  .credits {
    background: none; border: none; padding: 3px 7px; border-radius: 5px;
    font-size: 11px; font-variant-numeric: tabular-nums;
    color: var(--vscode-charts-green, #4caf50);
  }
  .credits:hover { background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,.16)); }

  /* --- conversation --- */
  .messages {
    flex: 1 1 auto; overflow-y: auto; overscroll-behavior: contain;
    padding: 14px 12px 20px;
    display: flex; flex-direction: column; gap: 24px;
  }

  .turn { display: flex; flex-direction: column; gap: 10px; animation: rise .18s ease-out; }

  /* --- the question: a bubble, right-aligned, the way a sent message reads --- */
  .question { display: flex; justify-content: flex-end; }
  .question-bubble {
    max-width: 88%;
    padding: 8px 12px;
    border-radius: 14px 14px 3px 14px;
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-widget-border, rgba(128,128,128,.2));
    white-space: pre-wrap; word-break: break-word; line-height: 1.5;
  }

  /* --- the answer --- */
  .answer { line-height: 1.62; }
  .thinking {
    font-size: 12px; color: var(--vscode-descriptionForeground);
    animation: pulse 1.3s ease-in-out infinite;
  }
  .caret {
    display: inline-block; width: 6px; height: 13px; margin-left: 2px;
    vertical-align: -2px; border-radius: 1px;
    background: var(--vscode-foreground); opacity: .7;
    animation: blink 1.1s step-end infinite;
  }

  .md > *:first-child { margin-top: 0; }
  .md > *:last-child { margin-bottom: 0; }
  .md p { margin: 0 0 10px; word-break: break-word; }
  .md h3 { font-size: 1.05em; margin: 18px 0 8px; }
  .md h4 { font-size: 1em; margin: 15px 0 6px; }
  .md ul, .md ol { margin: 0 0 10px; padding-left: 20px; }
  .md li { margin: 4px 0; padding-left: 2px; }
  .md li::marker { color: var(--vscode-descriptionForeground); }
  .md blockquote {
    margin: 0 0 10px; padding: 2px 0 2px 10px;
    border-left: 2px solid var(--vscode-widget-border, rgba(128,128,128,.35));
    color: var(--vscode-descriptionForeground);
  }
  .md hr {
    border: none; height: 1px; margin: 14px 0;
    background: var(--vscode-widget-border, rgba(128,128,128,.25));
  }
  .md strong { font-weight: 600; }
  .md .md-link { color: var(--vscode-textLink-foreground); text-decoration: underline; }
  .inline-code {
    font-family: var(--vscode-editor-font-family); font-size: .92em;
    background: var(--vscode-textCodeBlock-background);
    border-radius: 4px; padding: 1px 5px;
  }

  .code-block {
    border: 1px solid var(--vscode-widget-border, rgba(128,128,128,.25));
    border-radius: 8px; overflow: hidden; margin: 0 0 10px;
  }
  .code-head {
    display: flex; align-items: center; justify-content: space-between;
    padding: 2px 4px 2px 10px;
    font-size: 10px; letter-spacing: .07em; text-transform: uppercase;
    color: var(--vscode-descriptionForeground);
    background: var(--vscode-editorWidget-background);
    border-bottom: 1px solid var(--vscode-widget-border, rgba(128,128,128,.25));
  }
  .code-actions { display: flex; gap: 1px; }
  .code-block pre {
    margin: 0; padding: 10px 12px; overflow-x: auto;
    background: var(--vscode-textCodeBlock-background);
  }
  .code-block code {
    font-family: var(--vscode-editor-font-family);
    font-size: var(--vscode-editor-font-size, 12px);
    line-height: 1.55;
  }

  /* --- what the user can do with an answer --- */
  .answer-actions { display: flex; gap: 1px; align-items: center; margin-top: -4px; margin-left: -4px; }
  .answer-cost {
    margin-left: auto; padding-right: 2px;
    font-size: 11px; font-variant-numeric: tabular-nums;
    color: var(--vscode-descriptionForeground); opacity: .85;
  }

  /* --- sponsored: intentionally distinct from everything above it --- */
  .ad-slot {
    display: flex; flex-direction: column; gap: 12px; margin-top: 4px;
    animation: rise .22s ease-out;
  }
  .ad-rule { height: 1px; background: var(--vscode-widget-border, rgba(128,128,128,.25)); }

  .ad-card {
    display: flex; gap: 12px; align-items: flex-start;
    padding: 10px;
    border: 1px solid var(--vscode-widget-border, rgba(128,128,128,.3));
    border-radius: 12px;
    background: var(--vscode-editorWidget-background);
    transition: border-color .15s ease;
  }
  .ad-card:hover { border-color: var(--vscode-focusBorder); }

  .ad-media { flex: 0 0 auto; }
  /* Held out of the layout until the artwork reports its own proportions, so
     the slot appears once at its final size rather than reserving a square and
     then growing into a banner. A display:none image still loads. */
  .ad-media-pending { display: none; }

  .ad-media-thumbnail img, .ad-media-fallback {
    width: 76px; height: 76px; border-radius: 9px; object-fit: cover;
    display: block; cursor: pointer;
    background: var(--vscode-textCodeBlock-background);
  }
  .ad-media-fallback { display: flex; align-items: center; justify-content: center; }
  .ad-media-fallback .ad-avatar { width: 30px; height: 30px; font-size: 12px; }

  /* Artwork drawn as a wide strip spans the card instead of being cropped into
     a 76px square. The aspect is set inline from the image's own dimensions, so
     object-fit only crops for the extremes that get clamped. */
  .ad-card-banner { flex-direction: column; align-items: stretch; gap: 10px; }
  .ad-media-banner {
    width: 100%; border-radius: 9px; overflow: hidden;
    background: var(--vscode-textCodeBlock-background);
  }
  .ad-media-banner img {
    width: 100%; height: 100%; object-fit: cover; display: block; cursor: pointer;
  }

  .ad-content { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 4px; }

  .ad-meta { display: flex; align-items: center; gap: 6px; position: relative; }
  .ad-avatar {
    flex: 0 0 auto;
    width: 18px; height: 18px; border-radius: 50%;
    display: inline-flex; align-items: center; justify-content: center;
    font-size: 9px; font-weight: 700; letter-spacing: .02em;
    background: var(--vscode-badge-background); color: var(--vscode-badge-foreground);
  }
  .ad-advertiser {
    font-size: 12px; font-weight: 600;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .ad-badge {
    flex: 0 0 auto;
    font-size: 10px; line-height: 1; padding: 3px 6px; border-radius: 4px;
    color: var(--vscode-descriptionForeground);
    border: 1px solid var(--vscode-widget-border, rgba(128,128,128,.4));
  }
  .ad-menu-button {
    margin-left: auto; background: none; border: none; padding: 0 2px;
    font-size: 11px; letter-spacing: .05em; line-height: 1;
    color: var(--vscode-descriptionForeground); cursor: pointer;
  }
  .ad-menu-button:hover { color: var(--vscode-foreground); background: none; }
  .ad-menu {
    position: absolute; top: 20px; right: 0; z-index: 5;
    min-width: 148px; padding: 4px;
    display: flex; flex-direction: column;
    border: 1px solid var(--vscode-widget-border, rgba(128,128,128,.4));
    border-radius: 8px;
    background: var(--vscode-menu-background, var(--vscode-editorWidget-background));
    box-shadow: 0 6px 18px rgba(0,0,0,.38);
    animation: rise .12s ease-out;
  }
  .ad-menu button {
    background: none; border: none; text-align: left;
    padding: 6px 8px; border-radius: 5px; font-size: 12px;
    color: var(--vscode-menu-foreground, var(--vscode-foreground));
  }
  .ad-menu button:hover {
    background: var(--vscode-menu-selectionBackground, var(--vscode-list-hoverBackground));
    color: var(--vscode-menu-selectionForeground, var(--vscode-foreground));
  }

  .ad-headline {
    background: none; border: none; padding: 0; cursor: pointer;
    text-align: left; font-family: inherit; font-size: 13px; font-weight: 600;
    color: var(--vscode-foreground); line-height: 1.35;
  }
  .ad-headline:hover { background: none; text-decoration: underline; }
  .ad-body {
    font-size: 12px; line-height: 1.45;
    color: var(--vscode-descriptionForeground);
  }
  .ad-foot { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 4px; }
  .ad-cta {
    background: none; border: none; padding: 0;
    font-size: 12px; color: var(--vscode-textLink-foreground); cursor: pointer;
  }
  .ad-cta:hover { background: none; text-decoration: underline; }
  .ad-reward {
    font-size: 11px; color: var(--vscode-charts-green, #4caf50);
    font-variant-numeric: tabular-nums;
  }

  .ad-reasons {
    font-size: 11px; line-height: 1.6;
    color: var(--vscode-descriptionForeground);
    border: 1px solid var(--vscode-widget-border, rgba(128,128,128,.25));
    border-radius: 10px; padding: 10px;
    display: flex; flex-direction: column; gap: 6px; align-items: flex-start;
    animation: rise .16s ease-out;
  }
  .ad-reasons-title { color: var(--vscode-foreground); }
  .ad-reasons-note { opacity: .85; }
  .tag {
    display: inline-block; padding: 2px 6px; margin: 0 4px 4px 0;
    border-radius: 4px; background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground); font-size: 10px;
  }

  /* --- buttons --- */
  button {
    font-family: inherit; font-size: 12px; cursor: pointer;
    border-radius: 6px; padding: 4px 10px; border: none;
    background: none; color: inherit;
    transition: background-color .12s ease, color .12s ease, opacity .12s ease;
  }
  button:disabled { opacity: .45; cursor: default; }
  button.primary {
    background: var(--vscode-button-background); color: var(--vscode-button-foreground);
    padding: 5px 12px; font-weight: 500;
  }
  button.primary:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
  button.link { color: var(--vscode-textLink-foreground); padding: 0; }
  button.link:hover { text-decoration: underline; }
  button.ghost {
    padding: 3px 7px; font-size: 11px;
    color: var(--vscode-descriptionForeground);
  }
  button.ghost:hover:not(:disabled) {
    background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,.16));
    color: var(--vscode-foreground);
  }
  /* Icon-only actions. The square target stays finger-sized even though the
     glyph inside it is 14px, so the row is no harder to hit than the words it
     replaced. */
  button.ghost.action {
    display: inline-flex; align-items: center; justify-content: center;
    width: 24px; height: 24px; padding: 0; border-radius: 5px;
  }
  button.ghost.action.copied { color: var(--vscode-charts-green, #4caf50); }
  button.ghost.action.copied:hover:not(:disabled) { color: var(--vscode-charts-green, #4caf50); }
  button.stop {
    border: 1px solid var(--vscode-widget-border, rgba(128,128,128,.4));
    padding: 5px 12px;
  }
  button.stop:hover { background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,.16)); }

  /* --- empty states --- */
  .empty { padding: 20px 4px; display: flex; flex-direction: column; gap: 10px; }
  .empty-title { margin: 0; font-size: 13px; font-weight: 600; }
  .empty-note { margin: 0; font-size: 11px; color: var(--vscode-descriptionForeground); }
  .suggestions { display: flex; flex-direction: column; gap: 6px; margin-top: 2px; }
  .suggestion {
    text-align: left; line-height: 1.45; padding: 8px 10px;
    border: 1px solid var(--vscode-widget-border, rgba(128,128,128,.28));
    border-radius: 9px;
    color: var(--vscode-foreground);
  }
  .suggestion:hover {
    border-color: var(--vscode-focusBorder);
    background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,.1));
  }

  .signed-out {
    margin: auto; padding: 32px 22px; max-width: 320px;
    display: flex; flex-direction: column; align-items: center; gap: 10px;
    text-align: center;
  }
  .signed-out h2 { margin: 0; font-size: 15px; }
  .signed-out p {
    margin: 0; font-size: 12px; line-height: 1.6;
    color: var(--vscode-descriptionForeground);
  }
  .signed-out button { margin-top: 6px; }

  .error {
    border-left: 3px solid var(--vscode-errorForeground);
    border-radius: 0 6px 6px 0;
    padding: 8px 10px; color: var(--vscode-errorForeground); font-size: 12px;
    background: color-mix(in srgb, var(--vscode-errorForeground) 8%, transparent);
  }

  .toast {
    position: fixed; left: 50%; transform: translateX(-50%); bottom: 104px; z-index: 20;
    padding: 6px 13px; border-radius: 999px; font-size: 11px;
    background: var(--vscode-editorWidget-background);
    border: 1px solid var(--vscode-widget-border, rgba(128,128,128,.35));
    color: var(--vscode-charts-green, #4caf50);
    box-shadow: 0 6px 18px rgba(0,0,0,.32);
    animation: rise .18s ease-out;
  }

  /* --- composer --- */
  .composer {
    flex: 0 0 auto;
    border-top: 1px solid var(--vscode-widget-border, rgba(128,128,128,.22));
    padding: 10px 12px 9px;
  }
  .selection-chip {
    display: inline-flex; align-items: center; gap: 6px;
    font-size: 11px; margin-bottom: 7px; padding: 3px 9px;
    border-radius: 999px;
    color: var(--vscode-descriptionForeground);
    border: 1px solid var(--vscode-widget-border, rgba(128,128,128,.3));
  }
  .composer-box {
    display: flex; flex-direction: column; gap: 4px;
    padding: 6px 6px 6px 4px;
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, var(--vscode-widget-border, rgba(128,128,128,.3)));
    border-radius: 10px;
    transition: border-color .12s ease;
  }
  .composer-box:focus-within { border-color: var(--vscode-focusBorder); }
  .composer-box textarea {
    flex: 1 1 auto; min-height: 38px; max-height: 180px; resize: none;
    border: none; outline: none; background: none;
    padding: 5px 6px;
    font-family: inherit; font-size: inherit; line-height: 1.5;
    color: var(--vscode-input-foreground);
  }
  .composer-box textarea::placeholder { color: var(--vscode-input-placeholderForeground); }
  .composer-box button { flex: 0 0 auto; }
  .composer-bar {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    padding-left: 2px;
  }
  .composer-hint {
    margin-top: 6px; font-size: 10px;
    color: var(--vscode-descriptionForeground); opacity: .7;
  }

  /* --- session switcher ---------------------------------------------------
     The active conversation's name is always visible in the bar; the list of
     the others is one click away rather than permanently taking sidebar width. */
  .session-menu { position: relative; min-width: 0; flex: 1 1 auto; }
  .session-trigger {
    display: inline-flex; align-items: center; gap: 5px; max-width: 100%;
    padding: 3px 6px; border-radius: 6px;
    font-size: 12px; font-weight: 500; color: var(--vscode-foreground);
  }
  .session-trigger:hover { background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,.16)); }
  .session-trigger-title {
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .chevron { font-size: 9px; opacity: .6; flex: 0 0 auto; }

  .session-dropdown {
    position: absolute; top: calc(100% + 5px); left: 0; z-index: 40;
    min-width: 232px; max-width: 300px;
    padding: 4px;
    background: var(--vscode-menu-background, var(--vscode-editorWidget-background));
    border: 1px solid var(--vscode-menu-border, var(--vscode-widget-border, rgba(128,128,128,.35)));
    border-radius: 9px;
    box-shadow: 0 8px 26px rgba(0,0,0,.36);
    animation: rise .1s ease;
  }
  .session-new {
    display: block; width: 100%; text-align: left;
    padding: 6px 8px; border-radius: 6px;
    font-size: 12px; color: var(--vscode-textLink-foreground);
  }
  .session-new:hover { background: var(--vscode-list-hoverBackground, rgba(128,128,128,.14)); }

  .session-list { max-height: 264px; overflow-y: auto; margin-top: 2px; }
  .session-row {
    display: flex; align-items: center; gap: 2px;
    border-radius: 6px;
  }
  .session-row:hover { background: var(--vscode-list-hoverBackground, rgba(128,128,128,.14)); }
  .session-row.active { background: var(--vscode-list-activeSelectionBackground, rgba(128,128,128,.2)); }
  /* The row actions are quiet until the row is under the cursor: a list of
     conversations should read as titles, not as a grid of buttons. */
  .session-action { opacity: 0; padding: 4px 5px; font-size: 10px; border-radius: 5px; }
  .session-row:hover .session-action, .session-row.active .session-action { opacity: .65; }
  .session-action:hover { opacity: 1; background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,.2)); }

  .session-open {
    flex: 1 1 auto; min-width: 0; text-align: left;
    display: flex; flex-direction: column; gap: 1px;
    padding: 6px 8px;
  }
  .session-title {
    font-size: 12px; color: var(--vscode-foreground);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .session-meta {
    font-size: 10px; color: var(--vscode-descriptionForeground);
    font-variant-numeric: tabular-nums;
  }
  .session-rename {
    flex: 1 1 auto; margin: 3px;
    padding: 4px 6px; font-family: inherit; font-size: 12px;
    color: var(--vscode-input-foreground);
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-focusBorder); border-radius: 5px; outline: none;
  }
  .session-empty {
    padding: 10px 8px; font-size: 11px;
    color: var(--vscode-descriptionForeground);
  }

  button.ghost.icon { font-size: 14px; line-height: 1; padding: 2px 6px; }

  /* --- model picker --- */
  .model-menu { position: relative; }
  .model-trigger {
    display: inline-flex; align-items: center; gap: 5px;
    padding: 3px 7px; border-radius: 6px;
    font-size: 11px; color: var(--vscode-descriptionForeground);
  }
  .model-trigger:hover:not(:disabled) {
    background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,.16));
    color: var(--vscode-foreground);
  }
  /* Tier as a colour, so the cost of the current choice is legible at a glance
     without reading the price. */
  .model-dot { width: 6px; height: 6px; border-radius: 50%; flex: 0 0 auto; }
  .model-dot.fast { background: var(--vscode-charts-green, #4caf50); }
  .model-dot.standard { background: var(--vscode-charts-blue, #4a9eff); }
  .model-dot.premium { background: var(--vscode-charts-purple, #b180d7); }

  .model-dropdown {
    position: absolute; bottom: calc(100% + 6px); left: 0; z-index: 40;
    min-width: 246px;
    padding: 4px;
    background: var(--vscode-menu-background, var(--vscode-editorWidget-background));
    border: 1px solid var(--vscode-menu-border, var(--vscode-widget-border, rgba(128,128,128,.35)));
    border-radius: 9px;
    box-shadow: 0 8px 26px rgba(0,0,0,.36);
    animation: rise .1s ease;
  }
  .model-option {
    display: flex; flex-direction: column; gap: 2px; width: 100%;
    text-align: left; padding: 7px 8px; border-radius: 6px;
  }
  .model-option:hover { background: var(--vscode-list-hoverBackground, rgba(128,128,128,.14)); }
  .model-option.active { background: var(--vscode-list-activeSelectionBackground, rgba(128,128,128,.2)); }
  .model-option-head { display: flex; align-items: center; gap: 6px; }
  .model-option-label { font-size: 12px; font-weight: 500; color: var(--vscode-foreground); }
  .model-option-price {
    margin-left: auto; font-size: 10px; font-variant-numeric: tabular-nums;
    color: var(--vscode-descriptionForeground);
  }
  .model-option-description {
    font-size: 10.5px; line-height: 1.4;
    color: var(--vscode-descriptionForeground);
  }

  /* --- inline sponsored line ----------------------------------------------
     One row, shown while the answer is still streaming. It is deliberately
     quieter than the card — but never quieter than honest: the Ad badge and the
     advertiser are not removable, and the left marker keeps it visually apart
     from the assistant's own output. */
  /* Sits at the tail of the answer, standing in for the caret, so it hugs the
     last line rather than floating a full turn-gap below it. */
  .inline-ad {
    display: flex; align-items: center; gap: 7px;
    margin: -6px 0 0;
    padding: 5px 7px 5px 0;
    border-radius: 7px;
    font-size: 11.5px;
    animation: rise .16s ease;
    transition: opacity .14s ease;
  }
  .inline-ad.leaving { opacity: 0; }
  .inline-ad:hover { background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,.08)); }
  .inline-ad-marker {
    flex: 0 0 auto; width: 2px; align-self: stretch; border-radius: 2px;
    background: var(--vscode-charts-orange, #d18616); opacity: .75;
  }
  /* It replaced the caret, so it carries the caret's signal: still writing. */
  .inline-ad.streaming .inline-ad-marker { animation: blink 1.1s step-end infinite; }
  .inline-ad-badge {
    flex: 0 0 auto;
    padding: 1px 5px; border-radius: 3px;
    font-size: 9px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase;
    color: var(--vscode-charts-orange, #d18616);
    border: 1px solid color-mix(in srgb, var(--vscode-charts-orange, #d18616) 45%, transparent);
  }
  .inline-ad-text {
    flex: 1 1 auto; min-width: 0; text-align: left;
    display: flex; align-items: baseline; gap: 7px;
    padding: 0; line-height: 1.45;
    color: var(--vscode-descriptionForeground);
    overflow: hidden;
  }
  .inline-ad-text > :first-child {
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .inline-ad-text:hover { color: var(--vscode-foreground); }
  .inline-ad-cta {
    flex: 0 0 auto; font-size: 11px;
    color: var(--vscode-textLink-foreground);
  }
  .inline-ad-dismiss {
    flex: 0 0 auto; opacity: 0;
    padding: 2px 4px; font-size: 9px; border-radius: 4px;
    color: var(--vscode-descriptionForeground);
  }
  .inline-ad:hover .inline-ad-dismiss { opacity: .6; }
  .inline-ad-dismiss:hover { opacity: 1; background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,.2)); }

  /* --- tool trail ----------------------------------------------------------
     A quiet record of what the assistant actually touched. Deliberately closer
     to a caption than to a log: one line per call, the filename carrying the
     weight, so a glance answers "did it read my code or guess?" without the
     panel turning into a terminal. */
  .tool-trail { display: flex; flex-direction: column; gap: 2px; margin: 2px 0 8px; }

  .tool-line {
    display: flex; align-items: baseline; gap: 6px;
    padding: 2px 0; font-size: 11px;
    color: var(--vscode-descriptionForeground);
    animation: rise .12s ease;
  }
  .tool-icon { flex: 0 0 auto; width: 11px; font-size: 9px; opacity: .8; }
  .tool-line.running .tool-icon { animation: pulse 1s ease-in-out infinite; }
  .tool-line.error .tool-icon { color: var(--vscode-errorForeground, #f14c4c); }
  .tool-line.rejected .tool-icon { color: var(--vscode-descriptionForeground); }
  .tool-line.applied .tool-icon { color: var(--vscode-charts-green, #4caf50); }
  .tool-verb { flex: 0 0 auto; }
  .tool-target {
    min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    color: var(--vscode-foreground); opacity: .82;
    font-family: var(--vscode-editor-font-family); font-size: 10.5px;
  }
  .tool-diffstat {
    flex: 0 0 auto; font-size: 10px; font-variant-numeric: tabular-nums;
    color: var(--vscode-descriptionForeground);
  }
  .tool-error {
    min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    color: var(--vscode-errorForeground, #f14c4c);
  }

  /* A row that can be opened. It is a button so it is reachable by keyboard,
     and stripped back to a row so it does not look like one. */
  .tool-group { display: flex; flex-direction: column; }
  .tool-line.expandable {
    width: calc(100% + 8px);
    background: none; border: none; border-radius: 4px;
    margin: 0 -4px; padding: 2px 4px;
    font-family: inherit; font-size: 11px; text-align: left;
    cursor: pointer;
  }
  .tool-line.expandable:hover {
    background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,.1));
  }
  .tool-expand {
    flex: 0 0 auto; font-size: 11px; opacity: .55;
    transition: transform .12s ease-out;
  }
  .tool-expand.open { transform: rotate(90deg); }

  /* The query itself. Monospaced and scrollable rather than wrapped: GraphQL
     read at a width that reflows is harder to check than no GraphQL at all. */
  .tool-query {
    margin: 4px 0 2px;
    padding: 8px 10px;
    max-height: 220px; overflow: auto;
    border-radius: 5px;
    border: 1px solid var(--vscode-widget-border, rgba(128,128,128,.22));
    background: var(--vscode-textCodeBlock-background, rgba(128,128,128,.08));
    color: var(--vscode-foreground);
    font-family: var(--vscode-editor-font-family);
    font-size: 10.5px; line-height: 1.5;
    white-space: pre; tab-size: 2;
  }

  /* The one thing here that has not happened yet, and says so. */
  .tool-approval {
    margin: 6px 0;
    padding: 9px 10px;
    border: 1px solid var(--vscode-widget-border, rgba(128,128,128,.34));
    border-left: 2px solid var(--vscode-charts-blue, #4a9eff);
    border-radius: 8px;
    background: var(--vscode-editorWidget-background, rgba(128,128,128,.07));
    animation: rise .14s ease;
  }
  .tool-approval-head {
    display: flex; align-items: baseline; gap: 8px; margin-bottom: 3px;
  }
  .tool-approval-title {
    font-size: 11px; font-weight: 600; letter-spacing: .02em;
    color: var(--vscode-foreground);
  }
  .tool-approval-head .tool-diffstat { margin-left: auto; }
  .tool-approval-path {
    font-family: var(--vscode-editor-font-family); font-size: 11px;
    color: var(--vscode-foreground); opacity: .85;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .tool-approval-actions {
    display: flex; align-items: center; gap: 6px; margin-top: 8px;
  }
  .tool-approval-actions .spacer { flex: 1 1 auto; }
  button.primary.small { padding: 3px 10px; font-size: 11px; }

  /* One decision for a whole scaffold, when there is more than one file. */
  .tool-approval-all {
    display: flex; align-items: center; gap: 6px;
    margin-top: 2px; padding: 7px 10px;
    border: 1px solid var(--vscode-widget-border, rgba(128,128,128,.34));
    border-radius: 8px;
    background: var(--vscode-editorWidget-background, rgba(128,128,128,.07));
  }
  .tool-approval-all-count {
    flex: 1 1 auto; font-size: 11px; font-weight: 600;
    color: var(--vscode-foreground);
  }

  /* --- wide layouts ------------------------------------------------------- */
  /* The chat is an editor tab now, so it is as wide as the editor rather than as
     narrow as a sidebar. A 1200px line of prose is unreadable and a composer
     stretched that far reads as a form, so the content column is capped and
     centred. In a narrow window the cap is never reached, so none of this
     changes anything there.

     The full-bleed chrome is deliberately left alone: the topbar's rule and the
     composer's top border still span the whole tab, the way an editor's own
     edges do. Only what is read is constrained. */
  .turn, .empty, .composer-box, .composer-hint {
    width: 100%;
    max-width: 820px;
    margin-inline: auto;
  }
`;
