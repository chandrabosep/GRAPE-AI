import { env, requireEnv } from '../../config/index';
import { logger } from '../../lib/logger';

/**
 * The Graph Token API, served by Pinax.
 *
 * The second Graph product in the composition. The subgraph layer answers "did
 * this wallet interact with a protocol"; this answers "what does it hold and has
 * it moved recently", which the standardized schemas cannot.
 *
 * Mainnets only — there is no testnet coverage — which is why audience signals
 * come from a linked mainnet wallet rather than the freshly created embedded one.
 */

const DEFAULT_TIMEOUT_MS = 2_500;

interface TokenBalance {
  contract: string;
  symbol: string;
  amount: string;
  value?: number;
}

interface Transfer {
  timestamp?: number;
  datetime?: string;
}

async function get<T>(
  path: string,
  params: Record<string, string>,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<{ ok: boolean; data: T | null; latencyMs: number; error?: string }> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = new URL(`${env().PINAX_API_URL}${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

    const response = await fetch(url, {
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${requireEnv('PINAX_API_JWT')}`,
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

const STABLECOINS = new Set(['USDC', 'USDT', 'DAI', 'PYUSD', 'FRAX', 'USDE']);

export interface TokenApiSignals {
  ok: boolean;
  stablecoinHolder: boolean;
  nftHolder: boolean;
  recentTransfer: boolean;
  latencyMs: number;
  error?: string;
}

/**
 * Holdings and recent movement for one address on one chain.
 *
 * Returns categorical answers only. Balances are read to decide whether someone
 * holds a stablecoin at all; the amounts are deliberately not retained, because
 * an advertiser has no business knowing what a developer is worth.
 */
export async function fetchTokenApiSignals(
  address: string,
  network: string,
  sinceIso: string,
): Promise<TokenApiSignals> {
  const [balances, transfers, nfts] = await Promise.all([
    get<{ data?: TokenBalance[] }>('/v1/evm/balances', { network, address, limit: '100' }),
    get<{ data?: Transfer[] }>('/v1/evm/transfers', {
      network,
      from_address: address,
      start_time: sinceIso,
      limit: '1',
    }),
    get<{ data?: unknown[] }>('/v1/evm/nft/ownerships', { network, address, limit: '1' }),
  ]);

  if (!balances.ok && !transfers.ok && !nfts.ok) {
    const error = balances.error ?? transfers.error ?? nfts.error;
    logger.warn({ network, error }, 'token api unavailable');
    return {
      ok: false,
      stablecoinHolder: false,
      nftHolder: false,
      recentTransfer: false,
      latencyMs: Math.max(balances.latencyMs, transfers.latencyMs, nfts.latencyMs),
      ...(error ? { error } : {}),
    };
  }

  const held = balances.data?.data ?? [];

  return {
    ok: true,
    stablecoinHolder: held.some(
      (token) => STABLECOINS.has(token.symbol?.toUpperCase()) && Number(token.amount) > 0,
    ),
    nftHolder: (nfts.data?.data ?? []).length > 0,
    recentTransfer: (transfers.data?.data ?? []).length > 0,
    latencyMs: Math.max(balances.latencyMs, transfers.latencyMs, nfts.latencyMs),
  };
}
