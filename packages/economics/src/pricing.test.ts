import type { ModelPricing } from '@aam/shared';
import { describe, expect, it } from 'vitest';
import { affordableOutputTokens, checkAffordable, costMicro, reservationMicro } from './pricing.js';

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

describe('affordability', () => {
  it('allows a request the balance covers', () => {
    const check = checkAffordable(10_000n, 500_000n);
    expect(check).toEqual({
      affordable: true,
      costMicro: 10_000n,
      balanceAfterMicro: 490_000n,
      shortfallMicro: 0n,
    });
  });

  it('allows a request that spends the balance exactly', () => {
    expect(checkAffordable(10_000n, 10_000n)).toMatchObject({
      affordable: true,
      balanceAfterMicro: 0n,
    });
  });

  it('reports the shortfall rather than a negative balance', () => {
    const check = checkAffordable(10_000n, 4_000n);
    expect(check.affordable).toBe(false);
    expect(check.shortfallMicro).toBe(6_000n);
    expect(check.balanceAfterMicro).toBe(4_000n);
  });

  it('refuses everything on an empty balance', () => {
    expect(checkAffordable(1n, 0n).affordable).toBe(false);
  });
});

describe('clamping output to what the balance can pay for', () => {
  it('leaves a well-funded request untouched', () => {
    expect(affordableOutputTokens(SONNET, 4_000, 1_000_000n, 4_096)).toBe(4_096);
  });

  it('shortens the answer rather than running out mid-stream', () => {
    // 1,000 prompt chars = 250 input tokens, at 3 micro each = 750 micro.
    // The remaining 10,750 buys 716 output tokens at 15 micro each.
    const tokens = affordableOutputTokens(SONNET, 1_000, 11_500n, 4_096);
    expect(tokens).toBe(716);
  });

  it('returns zero when the prompt alone is unaffordable', () => {
    expect(affordableOutputTokens(SONNET, 100_000, 100n, 4_096)).toBe(0);
  });
});
