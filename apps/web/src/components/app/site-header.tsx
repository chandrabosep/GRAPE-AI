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
import { connectWalletConnect, signInWithWallet, WalletError } from '@/lib/wallet';

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

  /**
   * One entry point. WalletConnect's own modal lists installed browser wallets
   * next to the QR code, so a single button covers both desktop and phone
   * without us building a chooser.
   */
  const connect = async () => {
    setConnecting(true);
    try {
      const provider = await connectWalletConnect();
      const { address } = await signInWithWallet(provider);
      toast.success(`Signed in as ${address.slice(0, 6)}…${address.slice(-4)}`);
      await queryClient.invalidateQueries();
    } catch (error) {
      toast.error(
        error instanceof WalletError || error instanceof Error
          ? error.message
          : 'Could not connect your wallet.',
      );
    } finally {
      setConnecting(false);
    }
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
