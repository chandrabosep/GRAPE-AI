# GRAPE AI — VS Code extension

A coding assistant denominated in credits. Ask a question, get a streaming
answer, and see a clearly separated sponsored card that pays for your next
question.

## What it does

- Chat in the sidebar with streaming responses
- Sends the active selection and file language as context when you allow it
- Shows one relevant sponsored card per answer, or none at all when nothing is
  relevant enough
- Shows the credits an ad earned you, and the running balance in the status bar

## Where the ad sits

The sponsored card is a **sibling of the answer, never inside it**. That is
enforced in the component tree, not by styling. The SPONSORED label cannot be
dismissed, and "Why this ad?" shows exactly the derived signals that were
targeted, which is the complete set of things an advertiser ever sees.

The card must be genuinely on screen for a full second before it counts, so
scrolling past earns nothing.

This is also why the chat is a custom webview rather than a Chat Participant:
the participant API can only emit markdown and cannot render a visually distinct
card, and blending an ad into assistant text is exactly what this product refuses
to do.

## Secrets

The extension holds none. No API key, no wallet, no Privy credential. Signing in
opens the browser, and the signed-in web app mints a single-use code that is
exchanged for a session token stored in the OS keychain through VS Code's
SecretStorage.

If your browser or host will not redirect to a `vscode://` URL, the sign-in page
also shows the code for **GRAPE AI: Paste Sign-In Code**.

## Develop

```bash
pnpm --filter grape-ai dev   # esbuild watch
```

Then press F5 to launch the Extension Development Host. Point it at your API with
the `grapeAi.apiUrl` setting (default `https://grape-ai-dev.vercel.app`).

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `grapeAi.apiUrl` | `https://grape-ai-dev.vercel.app` | Base URL of the API |
| `grapeAi.includeSelection` | `true` | Send the current selection with your question |

Selections are used to answer you. They are never stored, and the intent
classifier that drives ad targeting never receives them.
