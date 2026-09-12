import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The subtle parts of the Graph integration.
 *
 * Two things here are easy to get wrong and impossible to notice in production:
 * the gateway reports failures as HTTP 200 with an error envelope, and two
 * incompatible DEX schema generations are deployed simultaneously. Both would
 * silently degrade to "this wallet has no onchain history", which is
 * indistinguishable from a real answer.
 */

process.env.GRAPH_GATEWAY_API_KEY = 'test-key';
process.env.PINAX_API_JWT = 'test-jwt';
process.env.PINAX_API_URL = 'https://api.pinax.network';

const { queryProtocolTouch } = await import('./queries');
const { SUBGRAPH_SOURCES, sourcesForChains, findSubgraphId, knownProtocols } = await import('./sources');
const { computeActivityScore } = await import('./service');
const { executeBlockchainQuery } = await import('./blockchain-tool');
const { fetchSubstreamsSignals } = await import('./substreams');
const { fetchTokenApiSignals } = await import('./token-api');

interface Captured {
  url: string;
  query: string;
  variables: Record<string, unknown>;
}

function stubGateway(payload: unknown, captured: Captured[] = []) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as {
        query: string;
        variables: Record<string, unknown>;
      };
      captured.push({ url: String(url), query: body.query, variables: body.variables });
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return captured;
}

afterEach(() => vi.unstubAllGlobals());

const lendingSource = SUBGRAPH_SOURCES.find((s) => s.key === 'aave-v3-ethereum')!;
const dexV4Source = SUBGRAPH_SOURCES.find((s) => s.key === 'uniswap-v3-ethereum')!;
const dexV1Source = SUBGRAPH_SOURCES.find((s) => s.key === 'uniswap-v2-ethereum')!;

describe('gateway error handling', () => {
  it('treats a 200 carrying GraphQL errors as a failure, not an empty result', async () => {
    stubGateway({ errors: [{ message: 'auth error: malformed API key' }] });

    const touch = await queryProtocolTouch(lendingSource, '0xABC', 1_757_000_000);

    // The distinction that matters: not ok, rather than "no activity".
    expect(touch.ok).toBe(false);
    expect(touch.touched).toBe(false);
    expect(touch.error).toContain('auth error');
  });

  it('reports a genuine empty result as a success', async () => {
    stubGateway({ data: { deposits: [], borrows: [], repays: [], withdraws: [] } });

    const touch = await queryProtocolTouch(lendingSource, '0xABC', 1_757_000_000);
    expect(touch.ok).toBe(true);
    expect(touch.touched).toBe(false);
  });
});

describe('standardized lending query', () => {
  it('detects activity from any of the four lending events', async () => {
    stubGateway({
      data: {
        deposits: [],
        borrows: [{ id: '1', timestamp: '1757100000' }],
        repays: [],
        withdraws: [],
      },
    });

    const touch = await queryProtocolTouch(lendingSource, '0xABC', 1_757_000_000);
    expect(touch.touched).toBe(true);
    expect(touch.lastActivityAt).toBe(1_757_100_000);
  });

  it('lowercases the address, because Messari keys accounts by lowercase', async () => {
    const captured = stubGateway({
      data: { deposits: [], borrows: [], repays: [], withdraws: [] },
    });

    await queryProtocolTouch(lendingSource, '0xD8dA6BF26964aF9D7eEd9e03E53415D37aA96045', 1_000);

    expect(captured[0]!.variables.account).toBe('0xd8da6bf26964af9d7eed9e03e53415d37aa96045');
  });

  it('sends BigInt variables as strings', async () => {
    const captured = stubGateway({
      data: { deposits: [], borrows: [], repays: [], withdraws: [] },
    });

    await queryProtocolTouch(lendingSource, '0xABC', 1_757_000_000);
    expect(captured[0]!.variables.since).toBe('1757000000');
  });

  it('uses one identical query across every lending protocol', async () => {
    const captured: Captured[] = [];
    stubGateway({ data: { deposits: [], borrows: [], repays: [], withdraws: [] } }, captured);

    const lendingSources = SUBGRAPH_SOURCES.filter((s) => s.type === 'lending');
    for (const source of lendingSources) {
      await queryProtocolTouch(source, '0xABC', 1_000);
    }

    // This is the standardization claim, asserted: Aave V2, Aave V3 on three
    // chains and Compound V3 all answer the same query text.
    const queries = new Set(captured.map((c) => c.query));
    expect(lendingSources.length).toBeGreaterThan(4);
    expect(queries.size).toBe(1);
  });
});

describe('DEX schema generations', () => {
  it('uses the account relation on 4.0.1 deployments', async () => {
    const captured = stubGateway({ data: { swaps: [] } });
    await queryProtocolTouch(dexV4Source, '0xABC', 1_000);

    expect(captured[0]!.query).toContain('account: $account');
    expect(captured[0]!.query).not.toContain('from: $account');
  });

  it('falls back to the plain from field on 1.3.2 deployments', async () => {
    const captured = stubGateway({ data: { swaps: [] } });
    await queryProtocolTouch(dexV1Source, '0xABC', 1_000);

    // 1.3.2 has no Account relation on Swap; querying `account` would error.
    expect(captured[0]!.query).toContain('from: $account');
  });

  it('normalises both generations to the same answer', async () => {
    stubGateway({ data: { swaps: [{ id: '1', timestamp: '1757100000' }] } });

    const v4 = await queryProtocolTouch(dexV4Source, '0xABC', 1_000);
    const v1 = await queryProtocolTouch(dexV1Source, '0xABC', 1_000);

    expect(v4.touched).toBe(true);
    expect(v1.touched).toBe(true);
  });
});

describe('source registry', () => {
  it('spans multiple protocols and chains', () => {
    const protocols = new Set(SUBGRAPH_SOURCES.map((s) => s.protocol));
    const chains = new Set(SUBGRAPH_SOURCES.map((s) => s.chain));
    expect(protocols.size).toBeGreaterThanOrEqual(5);
    expect(chains.size).toBeGreaterThanOrEqual(3);
  });

  it('filters by chain', () => {
    const mainnetOnly = sourcesForChains(['mainnet']);
    expect(mainnetOnly.every((s) => s.chain === 'mainnet')).toBe(true);
    expect(mainnetOnly.length).toBeLessThan(SUBGRAPH_SOURCES.length);
  });
});

describe('activity score', () => {
  it('is zero for a wallet with no protocol activity', () => {
    expect(computeActivityScore(0, null, 30)).toBe(0);
  });

  it('rewards recency', () => {
    const fresh = computeActivityScore(2, 1, 30);
    const stale = computeActivityScore(2, 29, 30);
    expect(fresh).toBeGreaterThan(stale);
  });

  it('rewards breadth across protocols', () => {
    const broad = computeActivityScore(3, 5, 30);
    const narrow = computeActivityScore(1, 5, 30);
    expect(broad).toBeGreaterThan(narrow);
  });

  it('stays within range', () => {
    expect(computeActivityScore(10, 0, 30)).toBeLessThanOrEqual(1);
    expect(computeActivityScore(1, 100, 30)).toBeGreaterThanOrEqual(0);
  });
});

describe('expanded source registry', () => {
  it('includes the new DEX protocols', () => {
    const protocols = new Set(SUBGRAPH_SOURCES.map((s) => s.protocol));
    expect(protocols.has('sushiswap-v3')).toBe(true);
    expect(protocols.has('curve')).toBe(true);
  });

  it('excludes deployments no indexer will serve', () => {
    // balancer-v2's `_meta` still answers at block 17670216 while every data
    // query returns `no attestation: indexing_error`. Keeping it cost a
    // guaranteed failure and ~950ms on every signal computation.
    const protocols = new Set(SUBGRAPH_SOURCES.map((s) => s.protocol));
    expect(protocols.has('balancer-v2')).toBe(false);
  });

  it('uses one identical query across Uniswap V3 and Sushiswap V3', async () => {
    const captured: Captured[] = [];
    stubGateway({ data: { swaps: [] } }, captured);

    const v4Sources = SUBGRAPH_SOURCES.filter((s) => s.schema === 'messari-dex-4');
    for (const source of v4Sources) {
      await queryProtocolTouch(source, '0xABC', 1_000);
    }

    const queries = new Set(captured.map((c) => c.query));
    expect(v4Sources.length).toBeGreaterThanOrEqual(5);
    expect(queries.size).toBe(1);
  });

  it('spans at least 8 protocols and 3 chains', () => {
    const protocols = new Set(SUBGRAPH_SOURCES.map((s) => s.protocol));
    const chains = new Set(SUBGRAPH_SOURCES.map((s) => s.chain));
    expect(protocols.size).toBeGreaterThanOrEqual(8);
    expect(chains.size).toBeGreaterThanOrEqual(3);
  });
});

describe('findSubgraphId', () => {
  it('resolves a known protocol to its deployment', () => {
    const match = findSubgraphId('aave-v3', 'mainnet');
    expect(match).not.toBeNull();
    expect(match!.subgraphId).toBeTruthy();
  });

  it('resolves ENS', () => {
    const match = findSubgraphId('ens');
    expect(match).not.toBeNull();
  });

  it('returns null for an unknown protocol', () => {
    expect(findSubgraphId('nonexistent')).toBeNull();
  });

  it('returns null for a known protocol on an unsupported chain', () => {
    expect(findSubgraphId('compound-v2', 'polygon')).toBeNull();
  });
});

describe('knownProtocols', () => {
  it('includes all registered protocols plus ENS', () => {
    const known = knownProtocols();
    expect(known).toContain('aave-v3');
    expect(known).toContain('uniswap-v3');
    expect(known).toContain('sushiswap-v3');
    expect(known).toContain('ens');
    expect(known.length).toBeGreaterThanOrEqual(9);
  });
});

describe('blockchain tool executor', () => {
  it('rejects invalid input', async () => {
    const result = await executeBlockchainQuery({ protocol: '' });
    expect(result.isError).toBe(true);
  });

  it('rejects an unknown protocol', async () => {
    const result = await executeBlockchainQuery({
      protocol: 'nonexistent',
      query: '{ protocols { id } }',
    });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Unknown protocol');
  });

  it('returns query results as JSON', async () => {
    stubGateway({ data: { protocols: [{ id: '1', name: 'Aave V3' }] } });

    const result = await executeBlockchainQuery({
      protocol: 'aave-v3',
      query: '{ protocols { id name } }',
    });

    expect(result.isError).toBe(false);
    expect(result.content).toContain('Aave V3');
    expect(result.content).toContain('aave-v3/mainnet');
  });

  it('reports graph errors cleanly', async () => {
    stubGateway({ errors: [{ message: 'rate limited' }] });

    const result = await executeBlockchainQuery({
      protocol: 'uniswap-v3',
      query: '{ swaps(first: 1) { id } }',
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain('rate limited');
  });
});

describe('substreams signals', () => {
  it('computes transfer metrics from Pinax data', async () => {
    stubGateway({});
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            data: [
              { from: '0xabc', to: '0x111', contract: '0xusdc', amount: '100', block_number: 1, timestamp: '2026-09-01' },
              { from: '0xabc', to: '0x222', contract: '0xweth', amount: '200', block_number: 2, timestamp: '2026-09-02' },
              { from: '0xabc', to: '0x333', contract: '0xdai', amount: '50', block_number: 3, timestamp: '2026-09-03' },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );

    const signals = await fetchSubstreamsSignals('0xABC', 'mainnet', '2026-09-01');
    expect(signals.ok).toBe(true);
    expect(signals.transferCount).toBe(6);
    expect(signals.uniqueTokens).toBe(3);
    expect(signals.uniqueCounterparties).toBeGreaterThanOrEqual(3);
  });

  it('handles total failure gracefully', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 500 })),
    );

    const signals = await fetchSubstreamsSignals('0xABC', 'mainnet', '2026-09-01');
    expect(signals.ok).toBe(false);
    expect(signals.transferCount).toBe(0);
  });
});


/**
 * The Pinax plan caps `limit` at 10 rows and rejects anything larger with HTTP
 * 403 — it does not truncate. Both call sites asked for 100, so Substreams
 * returned nothing at all and `stablecoinHolder` was pinned to false for every
 * wallet on the network. Neither was visible in a test that stubs `fetch`
 * without asserting what was requested, so these tests assert the request.
 */
interface PinaxCall {
  path: string;
  params: URLSearchParams;
}

function stubPinax(handler: (call: PinaxCall) => unknown, calls: PinaxCall[] = []) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      const call = { path: url.pathname, params: url.searchParams };
      calls.push(call);

      const result = handler(call);
      if (typeof result === 'number') {
        return new Response(JSON.stringify({ status: result, code: 'forbidden' }), {
          status: result,
        });
      }
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return calls;
}

describe('Pinax request limits', () => {
  it('never asks the Token API for more rows than the plan allows', async () => {
    const calls = stubPinax(() => ({ data: [] }));
    await fetchTokenApiSignals('0xABC', 'mainnet', '2026-09-01');

    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(Number(call.params.get('limit'))).toBeLessThanOrEqual(10);
    }
  });

  it('never asks Substreams for more rows than the plan allows', async () => {
    const calls = stubPinax(() => ({ data: [] }));
    await fetchSubstreamsSignals('0xABC', 'mainnet', '2026-09-01');

    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(Number(call.params.get('limit'))).toBeLessThanOrEqual(10);
    }
  });
});

describe('stablecoin detection', () => {
  it('asks for known stablecoin contracts one at a time', async () => {
    // `contract` accepts a single value per request, and `symbol` is accepted
    // and then ignored, so neither batching nor symbol filtering is an option.
    const calls = stubPinax(() => ({ data: [] }));
    await fetchTokenApiSignals('0xABC', 'mainnet', '2026-09-01');

    const balanceCalls = calls.filter((c) => c.path === '/v1/evm/balances');
    expect(balanceCalls.length).toBeGreaterThanOrEqual(3);
    for (const call of balanceCalls) {
      expect(call.params.get('contract')).toMatch(/^0x[0-9a-f]{40}$/);
      expect(call.params.get('symbol')).toBeNull();
    }
  });

  it('reports a holder when a filtered balance comes back non-zero', async () => {
    stubPinax(({ path, params }) => {
      if (path === '/v1/evm/balances') {
        // Only the first stablecoin contract is held.
        return params.get('contract') === '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
          ? { data: [{ contract: params.get('contract'), symbol: 'USDC', amount: '37192124' }] }
          : { data: [] };
      }
      return { data: [] };
    });

    const signals = await fetchTokenApiSignals('0xABC', 'mainnet', '2026-09-01');
    expect(signals.ok).toBe(true);
    expect(signals.stablecoinHolder).toBe(true);
  });

  it('does not report a holder on a zero balance', async () => {
    stubPinax(({ path, params }) =>
      path === '/v1/evm/balances'
        ? { data: [{ contract: params.get('contract'), symbol: 'USDC', amount: '0' }] }
        : { data: [] },
    );

    const signals = await fetchTokenApiSignals('0xABC', 'mainnet', '2026-09-01');
    expect(signals.stablecoinHolder).toBe(false);
  });

  it('reports failure instead of a silent false when balances are rejected', async () => {
    // The old guard was `!balances.ok && !transfers.ok && !nfts.ok`, so a
    // rejected balances call still reported ok:true — provenance claimed the
    // Token API had answered a question it never got to ask.
    stubPinax(({ path }) => (path === '/v1/evm/balances' ? 403 : { data: [] }));

    const signals = await fetchTokenApiSignals('0xABC', 'mainnet', '2026-09-01');
    expect(signals.ok).toBe(false);
    expect(signals.error).toContain('balances');
    expect(signals.stablecoinHolder).toBe(false);
  });

  it('still answers for a network with no stablecoin list', async () => {
    stubPinax(() => ({ data: [] }));
    const signals = await fetchTokenApiSignals('0xABC', 'optimism', '2026-09-01');
    expect(signals.ok).toBe(true);
    expect(signals.stablecoinHolder).toBe(false);
  });
});

describe('substreams paging', () => {
  it('pages past the row cap to reach the active-trader threshold', async () => {
    // 10 rows per page is under the active-trader bar of 10 transfers across 3
    // tokens, so the signal is only reachable by paging.
    const calls = stubPinax(({ params }) => {
      const page = Number(params.get('page'));
      if (page > 2) return { data: [] };
      return {
        data: Array.from({ length: 10 }, (_, i) => ({
          from: '0xabc',
          to: `0x${String(page * 100 + i).padStart(4, '0')}`,
          contract: `0xtoken${i % 4}`,
          amount: '1',
          block_num: i,
          datetime: '2026-09-01 00:00:00',
          timestamp: 1,
        })),
      };
    });

    const signals = await fetchSubstreamsSignals('0xABC', 'mainnet', '2026-09-01');
    expect(signals.ok).toBe(true);
    expect(signals.transferCount).toBe(40);
    expect(signals.uniqueTokens).toBe(4);
    expect(signals.isActiveTrader).toBe(true);
    expect(calls.length).toBe(6);
  });

  it('stops paging on a short page', async () => {
    const calls = stubPinax(() => ({
      data: [
        { from: '0xabc', to: '0x111', contract: '0xusdc', amount: '1', block_num: 1, datetime: '', timestamp: 1 },
      ],
    }));

    const signals = await fetchSubstreamsSignals('0xABC', 'mainnet', '2026-09-01');
    expect(signals.transferCount).toBe(2);
    // One request per direction, not three.
    expect(calls.length).toBe(2);
  });

  it('keeps a partial result when only one direction fails', async () => {
    stubPinax(({ params }) =>
      params.get('to_address')
        ? 403
        : {
            data: [
              { from: '0xabc', to: '0x111', contract: '0xusdc', amount: '1', block_num: 1, datetime: '', timestamp: 1 },
            ],
          },
    );

    const signals = await fetchSubstreamsSignals('0xABC', 'mainnet', '2026-09-01');
    expect(signals.ok).toBe(false);
    expect(signals.error).toContain('partial');
    expect(signals.transferCount).toBe(1);
  });
});
