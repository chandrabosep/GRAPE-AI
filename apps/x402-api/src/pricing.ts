import { env } from './config';

/** x402's asset id for native HBAR. Also exported as HBAR_ASSET_ID by @x402/hedera. */
export const HBAR_ASSET = '0.0.0';

const TINYBARS_PER_HBAR = 100_000_000n;

export interface Tier {
  /** Path suffix and the id agents see in discovery. */
  id: string;
  path: string;
  /** Hard cap on output tokens for this tier, enforced on the Bedrock call. */
  maxOutputTokens: number;
  /** Price in tinybars, as a decimal string for the wire. */
  tinybars: bigint;
  description: string;
}

/**
 * Two tiers rather than one flat fee.
 *
 * A flat per-request price makes a 50-token answer and a 4,000-token answer
 * cost the same, which is the thing metered billing exists to avoid. The output
 * cap is what is actually being sold, so it is what the price scales with, and
 * because the cap is enforced on the upstream call the buyer cannot be charged
 * the small price and served the large response.
 */
export function tiers(): Tier[] {
  const base = env().X402_PRICE_HBAR_TINYBARS;

  return [
    {
      id: 'small',
      path: '/v1/inference',
      maxOutputTokens: 512,
      tinybars: base,
      description: 'LLM inference, up to 512 output tokens.',
    },
    {
      id: 'large',
      path: '/v1/inference/large',
      maxOutputTokens: 4096,
      tinybars: base * 5n,
      description: 'LLM inference, up to 4096 output tokens.',
    },
  ];
}

export function tierByPath(path: string): Tier | undefined {
  return tiers().find((t) => t.path === path);
}

/** Display only — the wire always carries tinybars as an integer string. */
export function toHbar(tinybars: bigint): string {
  const whole = tinybars / TINYBARS_PER_HBAR;
  const frac = (tinybars % TINYBARS_PER_HBAR).toString().padStart(8, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : `${whole}`;
}

/**
 * The output ceiling a request actually gets.
 *
 * The tier is what was priced, so a client-supplied `maxTokens` can only lower
 * the ceiling, never raise it — otherwise the large response could be bought
 * at the small price. Absent or oversized values both collapse to the cap.
 */
export function resolveMaxTokens(requested: number | undefined, tier: Tier): number {
  if (requested === undefined) return tier.maxOutputTokens;
  return Math.min(requested, tier.maxOutputTokens);
}
