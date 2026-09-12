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
    expect(protocols.has('balancer-v2')).toBe(true);
    expect(protocols.has('curve')).toBe(true);
  });

  it('uses one identical query across Uniswap V3, Sushiswap V3 and Balancer V2', async () => {
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

  it('spans at least 9 protocols and 3 chains', () => {
    const protocols = new Set(SUBGRAPH_SOURCES.map((s) => s.protocol));
    const chains = new Set(SUBGRAPH_SOURCES.map((s) => s.chain));
    expect(protocols.size).toBeGreaterThanOrEqual(9);
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
    expect(known.length).toBeGreaterThanOrEqual(10);
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
