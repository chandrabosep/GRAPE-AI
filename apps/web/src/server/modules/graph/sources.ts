/**
 * The subgraphs the audience service queries.
 *
 * This registry is the point of the whole integration. Adding a protocol to
 * targeting is one entry here, not new code, because the standardized Messari
 * schemas mean one query shape spans every deployment that shares a schema
 * generation.
 *
 * IDs were verified as published and un-deprecated on the decentralized network
 * on 2026-09-09, and every entry below was confirmed on 2026-09-12 to answer a
 * real data query, not merely `_meta`. That distinction matters: a deployment
 * can report a block height and still fail every actual query, which is how
 * balancer-v2 passed a health check for as long as the check only read `_meta`.
 * `pnpm --filter @aam/web graph:health` now probes real data.
 *
 * A caveat worth knowing: messari/subgraphs has been unmaintained since March
 * 2025 and these deployments were last published in 2024. They are live and
 * served, but anything a protocol changed after 2024 is not indexed. That is a
 * known limitation of the standardized layer, not a bug in this code.
 */

export type SubgraphSchema =
  /** Messari lending 3.1.0 — `account` is a relation, event entities are plural. */
  | 'messari-lending-3'
  /** Messari lending 2.0.1 — same shape, but lacks fields added in 3.x. */
  | 'messari-lending-2'
  /** Messari dex-amm 4.0.1 — `Swap.account`, matches the lending shape. */
  | 'messari-dex-4'
  /** Messari dex-amm 1.3.2 — `Swap.from` is a plain String, there is no account relation. */
  | 'messari-dex-1'
  /** Messari dex-amm 3.1.3 — older relation-based schema used by some deployments. */
  | 'messari-dex-3';

export interface SubgraphSource {
  /** Stable key used in signal provenance. */
  key: string;
  /** Protocol slug advertisers target on. */
  protocol: string;
  type: 'lending' | 'dex';
  chain: string;
  subgraphId: string;
  schema: SubgraphSchema;
}

export const SUBGRAPH_SOURCES: SubgraphSource[] = [
  // --- lending: one query shape across all of these -------------------------
  {
    key: 'aave-v3-ethereum',
    protocol: 'aave-v3',
    type: 'lending',
    chain: 'mainnet',
    subgraphId: 'JCNWRypm7FYwV8fx5HhzZPSFaMxgkPuw4TnR3Gpi81zk',
    schema: 'messari-lending-3',
  },
  {
    key: 'aave-v3-arbitrum',
    protocol: 'aave-v3',
    type: 'lending',
    chain: 'arbitrum-one',
    subgraphId: '4xyasjQeREe7PxnF6wVdobZvCw5mhoHZq3T7guRpuNPf',
    schema: 'messari-lending-3',
  },
  // aave-v3-base removed: no indexer allocations on the decentralized network.
  {
    key: 'aave-v2-ethereum',
    protocol: 'aave-v2',
    type: 'lending',
    chain: 'mainnet',
    subgraphId: 'C2zniPn45RnLDGzVeGZCx2Sw3GXrbc9gL4ZfL8B8Em2j',
    schema: 'messari-lending-3',
  },
  {
    key: 'compound-v3-ethereum',
    protocol: 'compound-v3',
    type: 'lending',
    chain: 'mainnet',
    subgraphId: 'AwoxEZbiWLvv6e3QdvdMZw4WDURdGbvPfHmZRc8Dpfz9',
    schema: 'messari-lending-3',
  },
  {
    key: 'compound-v2-ethereum',
    protocol: 'compound-v2',
    type: 'lending',
    chain: 'mainnet',
    subgraphId: '4TbqVA8p2DoBd5qDbPMwmDZv3CsJjWtxo8nVSqF2tA9a',
    schema: 'messari-lending-2',
  },

  // --- dex ------------------------------------------------------------------
  {
    key: 'uniswap-v3-ethereum',
    protocol: 'uniswap-v3',
    type: 'dex',
    chain: 'mainnet',
    subgraphId: '4cKy6QQMc5tpfdx8yxfYeb9TLZmgLQe44ddW1G7NwkA6',
    schema: 'messari-dex-4',
  },
  {
    key: 'uniswap-v3-arbitrum',
    protocol: 'uniswap-v3',
    type: 'dex',
    chain: 'arbitrum-one',
    subgraphId: 'FQ6JYszEKApsBpAmiHesRsd9Ygc6mzmpNRANeVQFYoVX',
    schema: 'messari-dex-4',
  },
  {
    key: 'uniswap-v3-base',
    protocol: 'uniswap-v3',
    type: 'dex',
    chain: 'base',
    subgraphId: 'FUbEPQw1oMghy39fwWBFY5fE6MXPXZQtjncQy2cXdrNS',
    schema: 'messari-dex-4',
  },
  {
    key: 'uniswap-v2-ethereum',
    protocol: 'uniswap-v2',
    type: 'dex',
    chain: 'mainnet',
    subgraphId: '3onEbd9MLfXTTWAfP91yqsKr7C68VCT2ZiF7EoQiQAFj',
    schema: 'messari-dex-1',
  },

  // --- additional DEX: same standardized schema, zero new code ---------------
  {
    key: 'sushiswap-v3-ethereum',
    protocol: 'sushiswap-v3',
    type: 'dex',
    chain: 'mainnet',
    subgraphId: '2tGWMrDha4164KkFAfkU3rDCtuxGb4q1emXmFdLLzJ8x',
    schema: 'messari-dex-4',
  },
  {
    key: 'sushiswap-v3-arbitrum',
    protocol: 'sushiswap-v3',
    type: 'dex',
    chain: 'arbitrum-one',
    subgraphId: '3oHCddbQGTi42kPZBwyGzD2JzZR33zK2MwXtxAerNJy2',
    schema: 'messari-dex-4',
  },
  // balancer-v2-ethereum removed: every indexer serving it returns
  // `no attestation: indexing_error`. Its `_meta` still answers, at block
  // 17670216, which is why a health probe that only reads `_meta` called it
  // healthy — but no data query has succeeded against it. See the note on
  // probing below.
  {
    key: 'curve-ethereum',
    protocol: 'curve',
    type: 'dex',
    chain: 'mainnet',
    subgraphId: '3fy93eAT56UJsRCEht8iFhfi6wjHWXtZ9dnnbQmvFopF',
    schema: 'messari-dex-1',
  },
];

/** ENS has no Messari equivalent, so it is queried with its own schema. */
export const ENS_SUBGRAPH_ID = '5XqPmWe6gjyrJtFn9cLy237i4cWw2j9HcUJEXsP5qGtH';

export function sourcesForChains(chains: string[]): SubgraphSource[] {
  if (chains.length === 0) return SUBGRAPH_SOURCES;
  return SUBGRAPH_SOURCES.filter((source) => chains.includes(source.chain));
}

/**
 * Resolve a protocol + chain to a subgraph deployment ID.
 *
 * Used by the query_blockchain tool so the AI can target any protocol in the
 * registry by its human-readable slug rather than its deployment hash.
 */
export function findSubgraphId(
  protocol: string,
  chain = 'mainnet',
): { subgraphId: string; source: SubgraphSource } | null {
  if (protocol === 'ens') return { subgraphId: ENS_SUBGRAPH_ID, source: { key: 'ens', protocol: 'ens', type: 'dex', chain: 'mainnet', subgraphId: ENS_SUBGRAPH_ID, schema: 'messari-dex-1' } };
  const source = SUBGRAPH_SOURCES.find((s) => s.protocol === protocol && s.chain === chain);
  return source ? { subgraphId: source.subgraphId, source } : null;
}

/** All protocol slugs the registry knows about. */
export function knownProtocols(): string[] {
  const set = new Set(SUBGRAPH_SOURCES.map((s) => s.protocol));
  set.add('ens');
  return [...set];
}
