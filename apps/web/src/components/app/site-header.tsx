'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { formatCredits } from '@/lib/api';
import { useAuthActions, useMe } from '@/hooks/use-session';
import { signInWithWallet, WalletError, type Eip1193Provider } from '@/lib/wallet';
import { isWalletModalConfigured } from '@/lib/appkit';
import { useAppKit, useAppKitAccount, useAppKitProvider } from '@reown/appkit/react';
import { useEffect, useRef } from 'react';

const NAV = [
  { href: '/app', label: 'Dashboard' },
  { href: '/advertise', label: 'Advertise' },
];

export function SiteHeader() {
  const pathname = usePathname();
  const { data: me } = useMe();
  const { signOut } = useAuthActions();
  const queryClient = useQueryClient();
  const [connecting, setConnecting] = useState(false);

  const { open } = useAppKit();
  const { address, isConnected } = useAppKitAccount();
  const { walletProvider } = useAppKitProvider<Eip1193Provider>('eip155');
  const signedInFor = useRef<string | null>(null);

  /**
   * Connecting and signing in are two steps, and AppKit owns the first.
   *
   * The modal returns once a wallet is connected but gives no completion
   * callback, so the signature request is triggered by the connection appearing
   * rather than by the button. The ref guards against re-prompting on every
   * re-render, and against asking again for an address already signed in.
   */
  useEffect(() => {
    if (!isConnected || !address || !walletProvider || me) return;
    if (signedInFor.current === address) return;

    signedInFor.current = address;
    setConnecting(true);

    void signInWithWallet(walletProvider)
      .then(async (result) => {
        toast.success(`Signed in as ${result.address.slice(0, 6)}…${result.address.slice(-4)}`);
        await queryClient.invalidateQueries();
      })
      .catch((error: unknown) => {
        // Let them try again; a rejected signature is not a permanent state.
        signedInFor.current = null;
        toast.error(
          error instanceof WalletError || error instanceof Error
            ? error.message
            : 'Could not sign you in.',
        );
      })
      .finally(() => setConnecting(false));
  }, [isConnected, address, walletProvider, me, queryClient]);

  const connect = async () => {
    if (!isWalletModalConfigured()) {
      toast.error('Set NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID to enable wallet sign-in.');
      return;
    }
    await open({ view: 'Connect' });
  };

  return (
    <header className="border-border/60 bg-background/80 sticky top-0 z-40 border-b backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-6">
        <Link href="/" className="text-sm font-semibold tracking-tight">
          AI Attention Marketplace
        </Link>

        <nav className="hidden items-center gap-1 sm:flex">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                pathname.startsWith(item.href)
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          {me ? (
            <>
              <span className="text-muted-foreground hidden text-sm tabular-nums sm:inline">
                {formatCredits(me.credits.balanceMicro)} credits
              </span>
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
                  {me.user.displayName ?? 'Account'}
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
                      {me.user.roles.join(', ')}
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => void signOut()}>Sign out</DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <Button size="sm" onClick={() => void connect()} disabled={connecting}>
              {connecting ? 'Connecting…' : 'Connect Wallet'}
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
