import { describe, expect, it } from 'vitest';
import { formatMicro, microToUsd, splitMicro, usdToMicro } from './money.js';

describe('micro-USD conversion', () => {
  it('round-trips whole dollars', () => {
    expect(usdToMicro(100)).toBe(100_000_000n);
    expect(microToUsd(100_000_000n)).toBe(100);
  });

  it('formats a small reward the way the extension shows it', () => {
    expect(formatMicro(7_000n)).toBe('$0.0070');
  });
});

describe('splitMicro', () => {
  it('splits by ratio', () => {
    expect(splitMicro(1_000n, { a: 0.7, b: 0.3 })).toEqual({ a: 700n, b: 300n });
  });

  it('conserves the total for any amount', () => {
    const ratios = { reward: 0.7, platform: 0.2, treasury: 0.1 };
    for (let amount = 1n; amount < 500n; amount += 7n) {
      const parts = splitMicro(amount, ratios);
      const sum = Object.values(parts).reduce((a, b) => a + b, 0n);
      expect(sum).toBe(amount);
    }
  });

  it('gives the rounding remainder to the largest share', () => {
    const parts = splitMicro(10n, { reward: 0.7, platform: 0.2, treasury: 0.1 });
    expect(parts.reward).toBe(7n);
    expect(parts.reward! + parts.platform! + parts.treasury!).toBe(10n);
  });

  it('refuses ratios that do not sum to one', () => {
    expect(() => splitMicro(100n, { a: 0.5, b: 0.4 })).toThrow(/sum to 1/);
  });
});
