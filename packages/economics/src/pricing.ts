import type { EconomicsConfig, ModelPricing } from '@aam/shared';

/**
 * Token accounting.
 *
 * Actual cost always comes from the provider's own usage report, never from
 * anything the client says. These helpers exist for the pre-flight reservation
 * (how much allowance to hold before we start streaming) and for turning the
 * provider's final token counts into a charge.
 */

/** Rough character-to-token ratio for English + code. Used only for reservations. */
const CHARS_PER_TOKEN = 4;

export function estimateTokensFromChars(chars: number): number {
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

export function getModelPricing(config: EconomicsConfig, model: string): ModelPricing | null {
  return config.models[model] ?? null;
}

/** Exact cost from reported token counts, rounded up to the nearest micro-USD. */
export function costMicro(pricing: ModelPricing, inputTokens: number, outputTokens: number): bigint {
  const raw =
    inputTokens * pricing.inputMicroPerToken + outputTokens * pricing.outputMicroPerToken;
  return BigInt(Math.ceil(raw));
}

/**
 * Worst-case cost of a request, used to reserve allowance before the stream
 * starts. Assumes the model emits every token it is allowed to.
 */
export function reservationMicro(
  pricing: ModelPricing,
  promptChars: number,
  maxOutputTokens: number,
): bigint {
  return costMicro(pricing, estimateTokensFromChars(promptChars), maxOutputTokens);
}

export interface SpendCheck {
  affordable: boolean;
  costMicro: bigint;
  balanceAfterMicro: bigint;
  /** How much more the user needs. Zero when affordable. */
  shortfallMicro: bigint;
}

/**
 * Credits are the only currency, so paying for a request is a single question:
 * does the balance cover it?
 *
 * This replaced an allowance-then-credits split. Once credits became the sole
 * way to pay for inference there was no second bucket to fall back to — a free
 * tier is a starter grant of credits, not a separate allowance, which keeps one
 * balance and one ledger rather than two things to reconcile.
 */
export function checkAffordable(costMicro: bigint, balanceMicro: bigint): SpendCheck {
  const remaining = balanceMicro - costMicro;
  return {
    affordable: remaining >= 0n,
    costMicro,
    balanceAfterMicro: remaining >= 0n ? remaining : balanceMicro,
    shortfallMicro: remaining >= 0n ? 0n : -remaining,
  };
}

/**
 * Largest output the balance can pay for, given the prompt already committed.
 * Used to clamp maxTokens so a request cannot start and then run out of money
 * halfway through the answer.
 */
export function affordableOutputTokens(
  pricing: ModelPricing,
  promptChars: number,
  balanceMicro: bigint,
  requestedMaxTokens: number,
): number {
  const inputCost = costMicro(pricing, estimateTokensFromChars(promptChars), 0);
  const remaining = balanceMicro - inputCost;
  if (remaining <= 0n) return 0;
  if (pricing.outputMicroPerToken <= 0) return requestedMaxTokens;

  const affordable = Math.floor(Number(remaining) / pricing.outputMicroPerToken);
  return Math.max(0, Math.min(requestedMaxTokens, affordable));
}
