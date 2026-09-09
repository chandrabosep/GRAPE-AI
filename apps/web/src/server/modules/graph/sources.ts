/**
 * The subgraphs the audience service queries.
 *
 * This registry is the point of the whole integration. Adding a protocol to
 * targeting is one entry here, not new code, because the standardized Messari
 * schemas mean one query shape spans every deployment that shares a schema
 * generation.
 *
 * IDs were verified as published and un-deprecated on the decentralized network
 * on 2026-09-09. They still need a runtime health probe before being trusted for
 * a demo — `pnpm --filter @aam/web graph:health` runs it — because "published"
 * is not "freshly indexed".
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
  | 'messari-dex-1';

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
  {
    key: 'aave-v3-base',
    protocol: 'aave-v3',
    type: 'lending',
    chain: 'base',
    subgraphId: 'D7mapexM5ZsQckLJai2FawTKXJ7CqYGKM8PErnS3cJi9',
    schema: 'messari-lending-3',
  },
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
];

/** ENS has no Messari equivalent, so it is queried with its own schema. */
export const ENS_SUBGRAPH_ID = '5XqPmWe6gjyrJtFn9cLy237i4cWw2j9HcUJEXsP5qGtH';

export function sourcesForChains(chains: string[]): SubgraphSource[] {
  if (chains.length === 0) return SUBGRAPH_SOURCES;
  return SUBGRAPH_SOURCES.filter((source) => chains.includes(source.chain));
}
