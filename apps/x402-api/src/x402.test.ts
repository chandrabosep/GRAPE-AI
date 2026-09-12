import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FacilitatorClient } from '@x402/core/server';
import { createApp } from './app';
import { resolveMaxTokens, tierByPath, tiers, toHbar } from './pricing';

describe('pricing', () => {
  it('prices the large tier above the small one', () => {
    const [small, large] = tiers();
    expect(large.tinybars).toBeGreaterThan(small.tinybars);
    expect(large.maxOutputTokens).toBeGreaterThan(small.maxOutputTokens);
  });

  it('renders tinybars as HBAR without trailing zeros', () => {
    expect(toHbar(1_000_000n)).toBe('0.01');
    expect(toHbar(5_000_000n)).toBe('0.05');
    expect(toHbar(100_000_000n)).toBe('1');
  });

  it('resolves a path back to its tier', () => {
    expect(tierByPath('/v1/inference')?.id).toBe('small');
    expect(tierByPath('/v1/nope')).toBeUndefined();
  });
});

describe('output ceiling', () => {
  const [small] = tiers();

  it('defaults to the tier cap', () => {
    expect(resolveMaxTokens(undefined, small)).toBe(small.maxOutputTokens);
  });

  it('lets a client ask for less', () => {
    expect(resolveMaxTokens(10, small)).toBe(10);
  });

  // The one that matters: without this, the large answer is bought at the
  // small price just by asking for it.
  it('refuses to exceed the tier that was priced', () => {
    expect(resolveMaxTokens(999_999, small)).toBe(small.maxOutputTokens);
  });
});

describe('http surface', () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    // A stub rather than the real facilitator. Startup sync stays ON — it is
    // what teaches the server which kinds exist, and without it every 402 is a
    // 500 — but it now syncs against this object instead of the network.
    const facilitator: FacilitatorClient = {
      getSupported: async () => ({
        kinds: [
          {
            x402Version: 2,
            scheme: 'exact',
            network: 'hedera:testnet',
            extra: { feePayer: '0.0.7162784' },
          },
        ],
        extensions: [],
        signers: { 'hedera:*': ['0.0.7162784'] },
      }),
      verify: async () => {
        throw new Error('not exercised: these tests never pay');
      },
      settle: async () => {
        throw new Error('not exercised: these tests never pay');
      },
    };

    const app = createApp({ facilitator });
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('serves health without payment', async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });

  it('serves discovery without payment, so agents can find the price first', async () => {
    const res = await fetch(`${base}/.well-known/x402`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { resources: { id: string; price: { amount: string } }[] };
    expect(body.resources.map((r) => r.id)).toEqual(['small', 'large']);
    expect(body.resources[0]!.price.amount).toBe('1000000');
  });

  it('answers an unpaid inference call with 402 and terms', async () => {
    const res = await fetch(`${base}/v1/inference`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(res.status).toBe(402);

    const header = res.headers.get('PAYMENT-REQUIRED');
    expect(header).toBeTruthy();

    const terms = JSON.parse(Buffer.from(header!, 'base64').toString('utf8'));
    expect(terms.accepts[0]).toMatchObject({
      scheme: 'exact',
      network: 'hedera:testnet',
      asset: '0.0.0',
      amount: '1000000',
    });
  });

  it('quotes the higher price on the large tier', async () => {
    const res = await fetch(`${base}/v1/inference/large`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(res.status).toBe(402);
    const terms = JSON.parse(
      Buffer.from(res.headers.get('PAYMENT-REQUIRED')!, 'base64').toString('utf8'),
    );
    expect(terms.accepts[0].amount).toBe('5000000');
  });
});
