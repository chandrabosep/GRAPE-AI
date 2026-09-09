import { querySubgraph } from './gateway';
import type { SubgraphSource } from './sources';

/**
 * One question — "did this wallet touch this protocol since T?" — expressed once
 * per schema generation rather than once per protocol.
 *
 * The lending query below runs unchanged against Aave V2, Aave V3 on three
 * chains, and Compound V3. That reuse is the entire argument for building on a
 * standardized schema, and it is why adding a protocol is a config entry.
 *
 * The DEX side needs two variants because two incompatible generations are
 * deployed: 4.0.1 has `Swap.account` as a relation, 1.3.2 only has a plain
 * `from` string. Both are normalised to the same answer here so nothing
 * downstream has to care.
 */

/** Messari lending 3.1.0 and 2.0.1. Four ways to have touched a lending market. */
const LENDING_QUERY = `
  query LendingTouch($account: String!, $since: BigInt!) {
    deposits(first: 1, where: { account: $account, timestamp_gte: $since }) { id timestamp }
    borrows(first: 1, where: { account: $account, timestamp_gte: $since }) { id timestamp }
    repays(first: 1, where: { account: $account, timestamp_gte: $since }) { id timestamp }
    withdraws(first: 1, where: { account: $account, timestamp_gte: $since }) { id timestamp }
  }
`;

/** Messari dex-amm 4.0.1: same relation shape as lending. */
const DEX_QUERY_V4 = `
  query DexTouch($account: String!, $since: BigInt!) {
    swaps(first: 1, where: { account: $account, timestamp_gte: $since }) { id timestamp }
  }
`;

/** Messari dex-amm 1.3.2: no account relation, the trader is a plain string. */
const DEX_QUERY_V1 = `
  query DexTouchLegacy($account: String!, $since: BigInt!) {
    swaps(first: 1, where: { from: $account, timestamp_gte: $since }) { id timestamp }
  }
`;

interface TimestampedRow {
  id: string;
  timestamp: string;
}

interface LendingResponse {
  deposits: TimestampedRow[];
  borrows: TimestampedRow[];
  repays: TimestampedRow[];
  withdraws: TimestampedRow[];
}

interface DexResponse {
  swaps: TimestampedRow[];
}

export interface ProtocolTouch {
  source: SubgraphSource;
  touched: boolean;
  /** Unix seconds of the most recent matching event we saw, when known. */
  lastActivityAt: number | null;
  ok: boolean;
  latencyMs: number;
  error?: string;
}

function newestTimestamp(rows: TimestampedRow[][]): number | null {
  const timestamps = rows
    .flat()
    .map((row) => Number(row.timestamp))
    .filter((value) => Number.isFinite(value));
  return timestamps.length > 0 ? Math.max(...timestamps) : null;
}

/**
 * Asks one subgraph whether an address was active since a cutoff.
 *
 * Addresses must be lowercase: Messari keys `Account.id` by the lowercase
 * address, and a checksummed address silently matches nothing.
 */
export async function queryProtocolTouch(
  source: SubgraphSource,
  address: string,
  sinceUnixSeconds: number,
): Promise<ProtocolTouch> {
  const variables = {
    account: address.toLowerCase(),
    since: String(sinceUnixSeconds),
  };

  if (source.type === 'lending') {
    const result = await querySubgraph<LendingResponse>(source.subgraphId, LENDING_QUERY, variables);
    if (!result.ok || !result.data) {
      return {
        source,
        touched: false,
        lastActivityAt: null,
        ok: false,
        latencyMs: result.latencyMs,
        ...(result.error ? { error: result.error } : {}),
      };
    }

    const { deposits, borrows, repays, withdraws } = result.data;
    const rows = [deposits, borrows, repays, withdraws];
    return {
      source,
      touched: rows.some((r) => r.length > 0),
      lastActivityAt: newestTimestamp(rows),
      ok: true,
      latencyMs: result.latencyMs,
    };
  }

  const query = source.schema === 'messari-dex-4' ? DEX_QUERY_V4 : DEX_QUERY_V1;
  const result = await querySubgraph<DexResponse>(source.subgraphId, query, variables);

  if (!result.ok || !result.data) {
    return {
      source,
      touched: false,
      lastActivityAt: null,
      ok: false,
      latencyMs: result.latencyMs,
      ...(result.error ? { error: result.error } : {}),
    };
  }

  return {
    source,
    touched: result.data.swaps.length > 0,
    lastActivityAt: newestTimestamp([result.data.swaps]),
    ok: true,
    latencyMs: result.latencyMs,
  };
}

/** ENS uses its own schema; owning a name is a cheap, meaningful web3 signal. */
const ENS_QUERY = `
  query EnsNames($owner: String!) {
    domains(first: 1, where: { owner: $owner }) { id name }
  }
`;

export async function queryEnsOwnership(
  subgraphId: string,
  address: string,
): Promise<{ ok: boolean; holder: boolean; latencyMs: number; error?: string }> {
  const result = await querySubgraph<{ domains: { id: string; name: string }[] }>(
    subgraphId,
    ENS_QUERY,
    { owner: address.toLowerCase() },
  );

  if (!result.ok || !result.data) {
    return {
      ok: false,
      holder: false,
      latencyMs: result.latencyMs,
      ...(result.error ? { error: result.error } : {}),
    };
  }

  return { ok: true, holder: result.data.domains.length > 0, latencyMs: result.latencyMs };
}
