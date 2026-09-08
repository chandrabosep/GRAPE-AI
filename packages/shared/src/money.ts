/**
 * All money in this system is an integer count of micro-USD.
 *
 * 1_000_000 micro = $1.00. Integers only: floating point money in a ledger
 * that must balance to the cent is a bug waiting for the demo.
 * Postgres stores these as BigInt; carry them as `bigint` in TypeScript and
 * convert at the display edge only.
 */

export const MICRO_PER_USD = 1_000_000n;

export function usdToMicro(usd: number): bigint {
  return BigInt(Math.round(usd * 1_000_000));
}

export function microToUsd(micro: bigint): number {
  return Number(micro) / 1_000_000;
}

/** Renders micro-USD for humans, e.g. 7000n -> "$0.0070". */
export function formatMicro(micro: bigint, fractionDigits = 4): string {
  const usd = microToUsd(micro);
  return `$${usd.toFixed(fractionDigits)}`;
}

/**
 * Splits an amount by ratios that must sum to 1, giving any rounding remainder
 * to the largest share. The parts always add back to `total` exactly, which is
 * what keeps the campaign ledger from drifting.
 */
export function splitMicro(total: bigint, ratios: Record<string, number>): Record<string, bigint> {
  const keys = Object.keys(ratios);
  if (keys.length === 0) return {};

  const sum = keys.reduce((acc, k) => acc + (ratios[k] ?? 0), 0);
  if (Math.abs(sum - 1) > 1e-9) {
    throw new Error(`Allocation ratios must sum to 1, got ${sum}`);
  }

  const out: Record<string, bigint> = {};
  let assigned = 0n;
  for (const key of keys) {
    const part = (total * BigInt(Math.round((ratios[key] ?? 0) * 1_000_000))) / 1_000_000n;
    out[key] = part;
    assigned += part;
  }

  const remainder = total - assigned;
  if (remainder !== 0n) {
    const biggest = keys.reduce((a, b) => ((ratios[a] ?? 0) >= (ratios[b] ?? 0) ? a : b));
    out[biggest] = (out[biggest] ?? 0n) + remainder;
  }
  return out;
}

/** JSON.stringify replacer that renders bigint as a decimal string. */
export function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}
