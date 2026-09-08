import type { ModelPricing } from '@aam/shared';
import { describe, expect, it } from 'vitest';
import { costMicro, planSpend, reservationMicro } from './pricing.js';

const SONNET: ModelPricing = { inputMicroPerToken: 3, outputMicroPerToken: 15 };

describe('cost', () => {
  it('prices input and output separately', () => {
    expect(costMicro(SONNET, 1_000, 500)).toBe(BigInt(1_000 * 3 + 500 * 15));
  });

  it('rounds up so we never undercharge', () => {
    expect(costMicro({ inputMicroPerToken: 0.4, outputMicroPerToken: 0 }, 1, 0)).toBe(1n);
  });

  it('reserves against the full output allowance', () => {
    const reserved = reservationMicro(SONNET, 4_000, 4_096);
    expect(reserved).toBeGreaterThan(costMicro(SONNET, 1_000, 100));
  });
});

describe('spend planning', () => {
  it('uses the daily allowance first and charges nothing', () => {
    const plan = planSpend(1_000, 10_000n, 5_000, 500_000n, true);
    expect(plan).toEqual({
      fromAllowanceTokens: 1_000,
      fromCreditsMicro: 0n,
      shortfallMicro: 0n,
    });
  });

  it('falls back to earned credits once the allowance runs out', () => {
    const plan = planSpend(1_000, 10_000n, 0, 500_000n, true);
    expect(plan.fromAllowanceTokens).toBe(0);
    expect(plan.fromCreditsMicro).toBe(10_000n);
    expect(plan.shortfallMicro).toBe(0n);
  });

  it('splits a request that straddles the allowance boundary', () => {
    const plan = planSpend(1_000, 10_000n, 400, 500_000n, true);
    expect(plan.fromAllowanceTokens).toBe(400);
    expect(plan.fromCreditsMicro).toBe(6_000n);
    expect(plan.shortfallMicro).toBe(0n);
  });

  it('reports a shortfall when credits cannot cover the rest', () => {
    const plan = planSpend(1_000, 10_000n, 0, 4_000n, true);
    expect(plan.fromCreditsMicro).toBe(4_000n);
    expect(plan.shortfallMicro).toBe(6_000n);
  });

  it('reports the whole uncovered cost when credits are switched off', () => {
    const plan = planSpend(1_000, 10_000n, 0, 500_000n, false);
    expect(plan.fromCreditsMicro).toBe(0n);
    expect(plan.shortfallMicro).toBe(10_000n);
  });
});
