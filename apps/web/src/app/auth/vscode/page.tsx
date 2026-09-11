'use client';

import { use, useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { useMe } from '@/hooks/use-session';

/**
 * Browser to editor sign-in handoff.
 *
 * The extension opens this page with a random `state` and a callback URI. Once
 * the browser has an authenticated session, we mint a single-use code and hand
 * it back through the callback.
 *
 * The code, not the session token, is what travels in the URL. A callback URL
 * ends up in shell history, OS logs and crash reports, so the thing that lands
 * there must be short-lived, single-use and worthless on its own.
 */

/**
 * Editors that may receive the callback.
 *
 * An open redirect here would let any site harvest a sign-in code, so the scheme
 * is checked against a list rather than trusted from the query string.
 */
const ALLOWED_SCHEMES = ['vscode', 'vscode-insiders', 'vscodium', 'cursor', 'windsurf', 'code-oss'];

function isAllowedCallback(redirect: string): boolean {
  try {
    const scheme = new URL(redirect).protocol.replace(':', '');
    return ALLOWED_SCHEMES.includes(scheme);
  } catch {
    return false;
  }
}

export default function VsCodeAuthPage({ searchParams }: PageProps<'/auth/vscode'>) {
  const params = use(searchParams);
  const state = typeof params.state === 'string' ? params.state : '';
  const redirect = typeof params.redirect === 'string' ? params.redirect : '';

  const { data: me, isLoading } = useMe();
  const [code, setCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const mint = useMutation({
    mutationFn: () =>
      api<{ code: string }>('/auth/vscode/code', {
        method: 'POST',
        body: JSON.stringify({ state }),
      }),
    onSuccess: ({ code: issued }) => {
      setCode(issued);
      if (isAllowedCallback(redirect)) {
        const target = new URL(redirect);
        target.searchParams.set('code', issued);
        target.searchParams.set('state', state);
        // Sends the browser into the editor's URI handler.
        window.location.href = target.toString();
      }
    },
  });

  // Mint as soon as there is a session, so a signed-in user sees no extra step.
  useEffect(() => {
    if (me && state && !code && !mint.isPending && !mint.isError) mint.mutate();
  }, [me, state, code, mint]);

  if (!state || !redirect) {
    return (
      <Shell title="Missing sign-in request">
        <p>
          This page is opened by the VS Code extension. Run{' '}
          <Code>AI Marketplace: Sign In</Code> from the command palette instead.
        </p>
      </Shell>
    );
  }

  if (!isAllowedCallback(redirect)) {
    return (
      <Shell title="Unrecognised editor">
        <p>
          That callback does not point at a supported editor, so the sign-in was stopped. Supported:{' '}
          {ALLOWED_SCHEMES.join(', ')}.
        </p>
      </Shell>
    );
  }

  if (isLoading) return <Shell title="Checking your session">{null}</Shell>;

  if (!me) {
    return (
      <Shell title="Sign in to continue">
        <p>
          The extension is waiting. Sign in from the header — <strong>Connect Wallet</strong>, or{' '}
          <strong>Dev sign-in</strong> when running locally — and this page will hand your editor a
          sign-in code automatically.
        </p>
      </Shell>
    );
  }

  return (
    <Shell title={code ? 'Returning you to your editor' : 'Preparing your editor sign-in'}>
      {mint.isError && (
        <p className="text-destructive">
          Could not create a sign-in code. Close this tab and try signing in again.
        </p>
      )}

      {code && (
        <>
          <p>
            Your editor should now be signed in. If nothing happened, your browser may have blocked
            the redirect — paste this code into VS Code with{' '}
            <Code>AI Marketplace: Paste Sign-In Code</Code>.
          </p>

          <div className="bg-muted flex items-center gap-3 rounded-md p-3">
            <code className="flex-1 font-mono text-xs break-all">{code}</code>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void navigator.clipboard.writeText(code);
                setCopied(true);
              }}
            >
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>

          <p className="text-muted-foreground text-xs">
            This code expires in five minutes and can be used once.
          </p>
        </>
      )}
    </Shell>
  );
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-lg px-6 py-24">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm leading-relaxed">{children}</CardContent>
      </Card>
    </div>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="bg-muted rounded px-1 py-0.5 text-xs">{children}</code>;
}
