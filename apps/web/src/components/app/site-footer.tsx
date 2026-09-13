'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

/**
 * The coordinate footer — the brand's signature closing gesture.
 *
 * The source signs off its pages the way you'd sign a postcard: a '+' mark, a
 * two-part label on the left, and a live-updating readout with a heart on the
 * right. It is the one moment of warmth in an otherwise clinical system, and
 * dropping it would lose the thing that makes the page feel authored.
 *
 * The readout here is a real clock rather than a drifting GPS fix. The gesture
 * only works if the number is actually alive; inventing coordinates that move
 * would be decoration pretending to be telemetry, and this is a product whose
 * entire pitch is that it does not invent data about you.
 *
 * It renders empty until mounted, because a server-rendered clock and a client
 * one never agree.
 */
export function SiteFooter() {
  const [now, setNow] = useState<string | null>(null);

  useEffect(() => {
    const tick = () =>
      setNow(
        new Intl.DateTimeFormat('en-GB', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          timeZone: 'UTC',
          hour12: false,
        }).format(new Date()),
      );
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <footer className="border-hairline mt-auto border-t">
      <div className="mx-auto flex w-full max-w-[1200px] flex-wrap items-center gap-x-8 gap-y-4 px-6 py-8 md:px-10">
        <PlusMark />

        <div className="flex flex-wrap items-center gap-x-8 gap-y-2 text-sm">
          <span className="text-almost-white">Ads that pay for your AI</span>
          <span className="text-steel tracking-[0.06em]">
            <span className="display-serif">GRAPE</span> AI
          </span>
        </div>

        <nav className="text-steel flex flex-wrap items-center gap-x-6 gap-y-2 text-[12px] tracking-[0.07em] uppercase">
          <Link href="/app" className="hover:text-almost-white transition-colors">
            Dashboard
          </Link>
          <Link href="/advertise" className="hover:text-almost-white transition-colors">
            Advertise
          </Link>
          <Link href="/agents" className="hover:text-almost-white transition-colors">
            For agents
          </Link>
        </nav>

        <div className="text-steel ml-auto flex items-center gap-2.5 text-sm">
          <span className="tabular-nums" suppressHydrationWarning>
            {now ? `${now} UTC` : ' '}
          </span>
          <Heart />
        </div>
      </div>
    </footer>
  );
}

/* Line glyphs at 1px, drawn in the paper-white. The system has no filled icons. */

function PlusMark() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="text-almost-white size-4 shrink-0">
      <path d="M8 1.5v13M1.5 8h13" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

function Heart() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="text-almost-white size-3.5 shrink-0">
      <path
        d="M8 13.5S1.75 9.9 1.75 5.75A3.25 3.25 0 0 1 8 4.4a3.25 3.25 0 0 1 6.25 1.35C14.25 9.9 8 13.5 8 13.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinejoin="round"
      />
    </svg>
  );
}
