'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useAppKit, useAppKitAccount, useAppKitProvider, useDisconnect } from '@reown/appkit/react';
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
import { Credits } from '@/lib/credits';
import { useAuthActions, useMe, useSeedUsers } from '@/hooks/use-session';
import { isWalletModalConfigured } from '@/lib/appkit';
import { signInWithWallet, WalletError, type Eip1193Provider } from '@/lib/wallet';

const NAV = [
  { href: '/app', label: 'Dashboard' },
  { href: '/advertise', label: 'Advertise' },
  { href: '/agents', label: 'For agents' },
];

const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

/**
 * Wallet connection and app session are two separate things, and conflating
 * them is what made this confusing.
 *
 * AppKit owns the wallet connection. Our session is a signature on top of it.
 * So there are three states, and each needs its own affordance: not connected,
 * connected but not signed in, and signed in. Signing out has to tear down both
 * — clearing only our session left the wallet connected, which made the app look
 * signed out while refusing to sign in again.
 *
 * Visually this is the frosted bar: a translucent plum strip with a 10px
 * backdrop blur over the void. The blur is the design — it is what lets the
 * hero's atmosphere breathe through the navigation instead of being cut off by
 * it, so the bar must stay translucent even though a solid one would be easier.
 */
export function SiteHeader() {
  const pathname = usePathname();
  const { data: me } = useMe();
  const { signInAs, signOut } = useAuthActions();
  // Empty in any environment where real auth is configured, which is what makes
  // it safe to render unconditionally.
  const { data: seedUsers } = useSeedUsers();
  const queryClient = useQueryClient();

  const { open } = useAppKit();
  const { address, isConnected } = useAppKitAccount();
  const { walletProvider } = useAppKitProvider<Eip1193Provider>('eip155');
  const { disconnect } = useDisconnect();

  const [busy, setBusy] = useState(false);
  // Remembers which address we already prompted for, so a re-render cannot
  // trigger a second signature request.
  const promptedFor = useRef<string | null>(null);

  const authenticate = useCallback(async () => {
    if (!walletProvider || !address) return;
    setBusy(true);
    try {
      const result = await signInWithWallet(walletProvider);
      toast.success(`Signed in as ${short(result.address)}`);
      await queryClient.invalidateQueries();
    } catch (error) {
      // Deliberately does NOT clear promptedFor. Clearing it would let the
      // auto-prompt effect fire again the moment `busy` flips back to false,
      // re-opening the wallet forever. Retrying is the explicit "Sign in"
      // button's job, which calls this directly and bypasses the guard.
      toast.error(
        error instanceof WalletError || error instanceof Error
          ? error.message
          : 'Could not sign you in.',
      );
    } finally {
      setBusy(false);
    }
  }, [walletProvider, address, queryClient]);

  // Prompt once when a wallet first connects. If it is declined, the explicit
  // "Sign in" button below takes over rather than the app nagging.
  useEffect(() => {
    if (!isConnected || !address || !walletProvider || me || busy) return;
    if (promptedFor.current === address) return;
    promptedFor.current = address;
    void authenticate();
  }, [isConnected, address, walletProvider, me, busy, authenticate]);

  const fullSignOut = async () => {
    promptedFor.current = null;
    await signOut();
    // Without this the wallet stays connected and the app is stuck: signed out,
    // but unable to start a new sign-in.
    await disconnect().catch(() => undefined);
    toast.success('Disconnected');
  };

  const connect = async () => {
    if (!isWalletModalConfigured()) {
      toast.error('Set NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID to enable wallet sign-in.');
      return;
    }
    await open({ view: 'Connect' });
  };

  return (
    <header
      className="border-ash/60 sticky top-0 z-40 border-b backdrop-blur-[10px]"
      style={{ background: 'var(--nav-bg)' }}
    >
      <div className="mx-auto flex h-16 w-full max-w-[1200px] items-center gap-4 px-6 md:gap-8 md:px-10">
        <Link
          href="/"
          className="text-almost-white min-w-0 text-[15px] font-medium tracking-[0.06em]"
        >
          {/* The wordmark carries the one italic echo outside the hero, and it
              falls on the half of the name that is the name: "AI" is what the
              product does, "GRAPE" is what it is called.

              Set in caps, so the tracking opens up rather than tightening —
              the -0.01em that suited mixed case closes caps into a block. */}
          <span className="display-serif text-[19px] tracking-[0.01em]">GRAPE</span> AI
        </Link>

        <nav className="hidden items-center gap-7 sm:flex">
          {NAV.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                // The active item is marked by a 1px violet rule under the
                // label, which is the source's own active-nav gesture and the
                // page's single sanctioned violet stroke.
                className={`relative py-1.5 text-[12px] tracking-[0.07em] uppercase transition-colors ${
                  active
                    ? 'text-almost-white after:bg-signal-violet after:absolute after:inset-x-0 after:-bottom-px after:h-px after:content-[""]'
                    : 'text-steel hover:text-almost-white'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-3">
          {me ? (
            <>
              <Link
                href="/app/topup"
                className="text-steel hover:text-almost-white hidden text-[13px] tabular-nums transition-colors sm:inline"
              >
                <Credits micro={me.credits.balanceMicro} />{' '}
                <span className="text-graphite">credits</span>
              </Link>
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="secondary" size="sm" />}>
                  {address ? short(address) : (me.user.displayName ?? 'Account')}
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel className="stamp-sm px-2 py-1.5">
                      {me.user.roles.join(' · ')}
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem render={<Link href="/app/topup" />}>
                      Add credits
                    </DropdownMenuItem>
                    <DropdownMenuItem render={<Link href="/app/withdraw" />}>
                      Withdraw earnings
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => void open({ view: 'Account' })}>
                      Wallet
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => void fullSignOut()}>
                      Disconnect
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : isConnected && address ? (
            // Connected, but the signature was never completed.
            <>
              <span className="text-steel hidden text-[13px] sm:inline">{short(address)}</span>
              <Button size="sm" onClick={() => void authenticate()} disabled={busy}>
                {busy ? 'Check your wallet…' : 'Sign in'}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => void fullSignOut()}>
                Disconnect
              </Button>
            </>
          ) : (
            <>
              {/* Local development only: the endpoint behind this refuses to
                  answer in production or once Privy is configured, so the menu
                  disappears on its own rather than needing a flag. */}
              {(seedUsers ?? []).length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={<Button variant="ghost" size="sm" className="hidden sm:inline-flex" />}
                  >
                    Dev sign-in
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel className="stamp-sm px-2 py-1.5">
                      Seeded accounts
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {(seedUsers ?? []).map((user) => (
                      <DropdownMenuItem
                        key={user.subject}
                        onSelect={() => {
                          void signInAs(user.subject)
                            .then(() =>
                              toast.success(`Signed in as ${user.displayName ?? user.subject}`),
                            )
                            .catch((error: Error) => toast.error(error.message));
                        }}
                      >
                        {user.displayName ?? user.subject}
                        <span className="text-graphite ml-2 text-[11px]">
                          {user.roles.includes('advertiser') ? 'advertiser' : 'developer'}
                        </span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              {/* The one filled violet action in the chrome. */}
              <Button size="sm" onClick={() => void connect()} disabled={busy}>
                {busy ? 'Connecting…' : 'Connect Wallet'}
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
