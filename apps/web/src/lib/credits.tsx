'use client';

import { cn } from '@/lib/utils';

/**
 * The credit unit, and how it is written.
 *
 * Credits were rendered as `$2.74`, which misleads in the way that matters:
 * it reads as dollars in a bank account. A credit is a prepaid balance that
 * buys inference, and only the part earned from ads can ever leave as money —
 * so a user seeing `$` reasonably expects to withdraw all of it, and cannot.
 *
 * So credits carry their own mark. It is set in one place, and every balance in
 * the product reads through here, which is what keeps a rename to one line.
 */
export const CREDIT_SYMBOL = 'G$';

/** Real on-chain money, which is a different thing and says so. */
export const MONEY_SYMBOL = 'USDC';

function amount(micro: string | number | bigint | null | undefined, digits: number): string | null {
  if (micro === null || micro === undefined) return null;
  return (Number(micro) / 1_000_000).toFixed(digits);
}

/**
 * Credits as plain text, for a toast, a title attribute or a tooltip.
 *
 * Anything rendered into the page should prefer `<Credits>`, which sets the
 * mark smaller than the figure so the number stays the thing being read.
 */
export function formatCredits(
  micro: string | number | bigint | null | undefined,
  digits = 4,
): string {
  const value = amount(micro, digits);
  return value === null ? '—' : `${CREDIT_SYMBOL}${value}`;
}

/**
 * Plain dollars, for money that really is money.
 *
 * An advertiser's budget, bid and spend are USD they have funded — quoting
 * those in credits would be the same confusion in the other direction.
 */
export function formatUsd(
  micro: string | number | bigint | null | undefined,
  digits = 4,
): string {
  const value = amount(micro, digits);
  return value === null ? '—' : `$${value}`;
}

/** USDC, the actual token — written after the figure, the way a ticker is. */
export function formatUsdc(
  micro: string | number | bigint | null | undefined,
  digits = 2,
): string {
  const value = amount(micro, digits);
  return value === null ? '—' : `${value} ${MONEY_SYMBOL}`;
}

/**
 * A credit figure with its mark.
 *
 * The mark is sized in `em` rather than pixels so one component serves the
 * 40px balance on the top-up page and the 13px figure in the header, staying
 * subordinate to the number at both ends. It is deliberately quiet: the reader
 * needs to know the unit is not dollars, not to read the unit first.
 */
export function Credits({
  micro,
  digits = 4,
  className,
}: {
  micro: string | number | bigint | null | undefined;
  digits?: number;
  className?: string;
}) {
  const value = amount(micro, digits);
  if (value === null) return <span className={className}>—</span>;

  return (
    <span className={cn('whitespace-nowrap tabular-nums', className)}>
      <span className="mr-[0.12em] align-[0.06em] text-[0.6em] tracking-[0.06em] opacity-65">
        {CREDIT_SYMBOL}
      </span>
      {value}
    </span>
  );
}
