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

export interface SpendPlan {
  fromAllowanceTokens: number;
  fromCreditsMicro: bigint;
  shortfallMicro: bigint;
}

/**
 * Decides how a request gets paid for: daily plan allowance first, then earned
 * credits. A non-zero shortfall means the request must be refused.
 */
export function planSpend(
  totalTokens: number,
  costMicroValue: bigint,
  allowanceTokensRemaining: number,
  creditBalanceMicro: bigint,
  creditsEnabled: boolean,
): SpendPlan {
  const fromAllowance = Math.max(0, Math.min(totalTokens, allowanceTokensRemaining));
  if (fromAllowance === totalTokens) {
    return { fromAllowanceTokens: fromAllowance, fromCreditsMicro: 0n, shortfallMicro: 0n };
  }

  const uncoveredRatio = (totalTokens - fromAllowance) / totalTokens;
  const uncoveredMicro = BigInt(Math.ceil(Number(costMicroValue) * uncoveredRatio));

  if (!creditsEnabled) {
    return {
      fromAllowanceTokens: fromAllowance,
      fromCreditsMicro: 0n,
      shortfallMicro: uncoveredMicro,
    };
  }

  const fromCredits = uncoveredMicro <= creditBalanceMicro ? uncoveredMicro : creditBalanceMicro;
  return {
    fromAllowanceTokens: fromAllowance,
    fromCreditsMicro: fromCredits,
    shortfallMicro: uncoveredMicro - fromCredits,
  };
}
