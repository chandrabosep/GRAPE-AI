import { env } from '../../config/index';
import { logger } from '../../lib/logger';

/**
 * The third Graph product in the composition: Substreams.
 *
 * Pinax serves Substreams-processed EVM data via REST. The Token API gives
 * aggregate holdings; this gives block-level ERC-20 transfer events — finer
 * granularity that lets us detect active traders and high-frequency movers
 * that a balance snapshot misses.
 *
 * The endpoint is backed by the `pinax-network/erc20-transfers` Substreams
 * module, which is why the provenance records the product as `substreams`
 * rather than `token-api`.
 */

const DEFAULT_TIMEOUT_MS = 5_000;

/**
 * The plan's hard ceiling on rows per request. Exceeding it is rejected with
 * `403 Parameter 'limit' exceeds maximum of 10 items` rather than truncated, so
 * breadth has to come from paging instead of one large request.
 */
const MAX_LIMIT = 10;

/** Up to 30 transfers per direction — enough to clear the active-trader bar. */
const MAX_PAGES = 3;

/** Field names as the API actually returns them. */
interface Erc20Transfer {
  from: string;
  to: string;
  contract: string;
  amount: string;
  block_num: number;
  datetime: string;
  timestamp: number;
}

export interface SubstreamsSignals {
  ok: boolean;
  transferCount: number;
  uniqueTokens: number;
  uniqueCounterparties: number;
  isActiveTrader: boolean;
  latencyMs: number;
  error?: string;
}

async function get<T>(
  path: string,
  params: Record<string, string>,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<{ ok: boolean; data: T | null; latencyMs: number; error?: string }> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const jwt = env().PINAX_API_JWT;
  if (!jwt) {
    return { ok: false, data: null, latencyMs: 0, error: 'PINAX_API_JWT not configured' };
  }

  try {
    const url = new URL(`${env().PINAX_API_URL}${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

    const response = await fetch(url, {
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${jwt}`,
      },
      signal: controller.signal,
    });

    const latencyMs = Date.now() - started;

    if (!response.ok) {
      return { ok: false, data: null, latencyMs, error: `HTTP ${response.status}` };
    }

    return { ok: true, data: (await response.json()) as T, latencyMs };
  } catch (error) {
    const latencyMs = Date.now() - started;
    return {
      ok: false,
      data: null,
      latencyMs,
      error: controller.signal.aborted ? 'timeout' : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Pages one direction of transfers up to `MAX_PAGES`.
 *
 * A short page means the history is exhausted, so paging stops there rather
 * than spending two more requests to learn the same thing.
 */
async function fetchTransferPages(
  params: Record<string, string>,
): Promise<{ ok: boolean; rows: Erc20Transfer[]; latencyMs: number; error?: string }> {
  const rows: Erc20Transfer[] = [];
  let latencyMs = 0;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const result = await get<{ data?: Erc20Transfer[] }>('/v1/evm/transfers', {
      ...params,
      limit: String(MAX_LIMIT),
      page: String(page),
    });
    latencyMs += result.latencyMs;

    if (!result.ok) {
      // Failing on the first page means this direction went unanswered. Failing
      // later just caps the window, and what we already have is still valid.
      if (page === 1) {
        return { ok: false, rows, latencyMs, ...(result.error ? { error: result.error } : {}) };
      }
      return { ok: true, rows, latencyMs };
    }

    const batch = result.data?.data ?? [];
    rows.push(...batch);
    if (batch.length < MAX_LIMIT) break;
  }

  return { ok: true, rows, latencyMs };
}

/**
 * Substreams-backed ERC-20 transfer analysis for one address.
 *
 * Returns activity metrics derived from the `erc20-transfers` Substreams
 * module: how many transfers, how many distinct tokens and counterparties.
 * A wallet with 10+ transfers across 3+ tokens in the window is classified
 * as an active trader — a signal the Token API's boolean cannot express.
 */
export async function fetchSubstreamsSignals(
  address: string,
  network: string,
  sinceIso: string,
): Promise<SubstreamsSignals> {
  const addr = address.toLowerCase();

  const [outbound, inbound] = await Promise.all([
    fetchTransferPages({ network, from_address: addr, start_time: sinceIso }),
    fetchTransferPages({ network, to_address: addr, start_time: sinceIso }),
  ]);

  const latencyMs = Math.max(outbound.latencyMs, inbound.latencyMs);

  if (!outbound.ok && !inbound.ok) {
    const error = outbound.error ?? inbound.error;
    logger.warn({ network, error }, 'substreams transfer query unavailable');
    return {
      ok: false,
      transferCount: 0,
      uniqueTokens: 0,
      uniqueCounterparties: 0,
      isActiveTrader: false,
      latencyMs,
      ...(error ? { error } : {}),
    };
  }

  const allTransfers = [...outbound.rows, ...inbound.rows];

  const tokens = new Set<string>();
  const counterparties = new Set<string>();

  for (const tx of allTransfers) {
    if (tx.contract) tokens.add(tx.contract.toLowerCase());
    const other = tx.from?.toLowerCase() === addr ? tx.to : tx.from;
    if (other) counterparties.add(other.toLowerCase());
  }

  const transferCount = allTransfers.length;
  const uniqueTokens = tokens.size;
  const uniqueCounterparties = counterparties.size;

  // One direction answering is a usable partial result, but say so.
  const halfAnswered = !outbound.ok || !inbound.ok;
  const error = halfAnswered
    ? `partial: ${(outbound.ok ? inbound.error : outbound.error) ?? 'one direction failed'}`
    : undefined;

  return {
    ok: !halfAnswered,
    transferCount,
    uniqueTokens,
    uniqueCounterparties,
    isActiveTrader: transferCount >= 10 && uniqueTokens >= 3,
    latencyMs,
    ...(error ? { error } : {}),
  };
}
