'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { formatCredits } from '@/lib/api';
import { useAuthActions, useMe, useSeedUsers } from '@/hooks/use-session';
import { hasInjectedWallet, signInWithWallet, WalletError } from '@/lib/wallet';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const NAV = [
  { href: '/app', label: 'Dashboard' },
  { href: '/advertise', label: 'Advertise' },
];

export function SiteHeader() {
  const pathname = usePathname();
  const { data: me } = useMe();
  const { data: seedUsers = [] } = useSeedUsers();
  const { signInAs, signOut } = useAuthActions();
  const queryClient = useQueryClient();
  const [connecting, setConnecting] = useState(false);

  const connectWallet = async () => {
    setConnecting(true);
    try {
      const { address } = await signInWithWallet();
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
                <DropdownMenuTrigger
                  render={<Button variant="outline" size="sm" />}
                >
                  {me.user.displayName ?? 'Account'}
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
                    {me.user.roles.join(', ')}
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => void signOut()}>Sign out</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button size="sm" />}>Sign in</DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72">
                <DropdownMenuItem
                  onSelect={(event) => {
                    event.preventDefault();
                    void connectWallet();
                  }}
                  disabled={connecting}
                >
                  {connecting
                    ? 'Check your wallet…'
                    : hasInjectedWallet()
                      ? 'Connect wallet'
                      : 'Connect wallet (none detected)'}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
                  Or sign in as a seeded account, for development
                </DropdownMenuLabel>
                {seedUsers.length === 0 && (
                  <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
                    No seeded accounts. Run <code>pnpm db:seed</code>.
                  </DropdownMenuLabel>
                )}
                {seedUsers.map((user) => (
                  <DropdownMenuItem
                    key={user.subject}
                    onSelect={() => void signInAs(user.subject)}
                    className="flex flex-col items-start gap-0.5"
                  >
                    <span>{user.displayName ?? user.subject}</span>
                    <span className="text-muted-foreground text-xs">
                      {user.roles.includes('advertiser') ? 'advertiser' : 'developer'} ·{' '}
                      {formatCredits(user.creditBalanceMicro)}
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
    </header>
  );
}
