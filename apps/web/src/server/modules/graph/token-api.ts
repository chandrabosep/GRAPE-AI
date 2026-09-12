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

// Observed 1.2s for balances and 1.8s for NFT ownerships against real wallets,
// and these requests contend with each other. 2.5s produced flapping signals:
// the same address answered nftHolder differently on consecutive calls.
const DEFAULT_TIMEOUT_MS = 5_000;

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

/**
 * Stablecoin contracts per network.
 *
 * Stablecoin holding cannot be answered by scanning a wallet's balance list.
 * The plan caps `limit` at 10 rows — and rejects a larger request outright with
 * `403 Parameter 'limit' exceeds maximum of 10 items` rather than truncating it.
 * With only 10 rows available, and real wallets' top rows dominated by
 * airdropped spam tokens, a stablecoin is almost never on the first page — the
 * previous symbol-matching approach therefore reported `false` for every wallet
 * on the network. Filtering by contract asks the question directly instead.
 *
 * Two API constraints shape this. `symbol` is accepted and then silently
 * ignored, so it cannot be used as a filter; and `contract` takes exactly one
 * value per request (`403 ... exceed maximum batch limit of 1`), so this is one
 * small request per token rather than one batched call.
 *
 * Addresses were verified on 2026-09-12 against the symbol the API itself
 * returns for each contract. Arbitrum's canonical Tether reports as `USD₮0`
 * rather than `USDT`, which is the reason presence at a known contract is the
 * signal here and a symbol match is not.
 */
const STABLECOIN_CONTRACTS: Record<string, string[]> = {
  mainnet: [
    '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC
    '0xdac17f958d2ee523a2206206994597c13d831ec7', // USDT
    '0x6b175474e89094c44da98b954eedeac495271d0f', // DAI
  ],
  base: [
    '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // USDC
    '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca', // USDbC
    '0x50c5725949a6f0c72e6c4a641f24049a917db0cb', // DAI
  ],
  'arbitrum-one': [
    '0xaf88d065e77c8cc2239327c5edb3a432268e5831', // USDC
    '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', // USDT (reports as USD₮0)
    '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1', // DAI
  ],
};

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
 *
 * `ok` means every sub-request answered. A partial answer is still returned and
 * still usable — but it is reported as a failure, because the alternative is
 * what this function used to do: succeed loudly while one field was silently
 * pinned to `false`.
 */
export async function fetchTokenApiSignals(
  address: string,
  network: string,
  sinceIso: string,
): Promise<TokenApiSignals> {
  const stablecoins = STABLECOIN_CONTRACTS[network] ?? [];

  const [transfers, nfts, ...balances] = await Promise.all([
    get<{ data?: Transfer[] }>('/v1/evm/transfers', {
      network,
      from_address: address,
      start_time: sinceIso,
      limit: '1',
    }),
    get<{ data?: unknown[] }>('/v1/evm/nft/ownerships', { network, address, limit: '1' }),
    ...stablecoins.map((contract) =>
      get<{ data?: TokenBalance[] }>('/v1/evm/balances', {
        network,
        address,
        contract,
        limit: '1',
      }),
    ),
  ]);

  const latencyMs = Math.max(
    transfers.latencyMs,
    nfts.latencyMs,
    ...balances.map((b) => b.latencyMs),
  );

  // Nothing answered at all: report it and let the caller fall back.
  if (!transfers.ok && !nfts.ok && !balances.some((b) => b.ok)) {
    const error = transfers.error ?? nfts.error ?? balances.find((b) => b.error)?.error;
    logger.warn({ network, error }, 'token api unavailable');
    return {
      ok: false,
      stablecoinHolder: false,
      nftHolder: false,
      recentTransfer: false,
      latencyMs,
      ...(error ? { error } : {}),
    };
  }

  const failures: string[] = [];
  if (!transfers.ok) failures.push(`transfers: ${transfers.error ?? 'failed'}`);
  if (!nfts.ok) failures.push(`nft: ${nfts.error ?? 'failed'}`);
  const failedBalance = balances.find((b) => !b.ok);
  if (failedBalance) {
    failures.push(`balances: ${failedBalance.error ?? 'failed'} (${balances.filter((b) => !b.ok).length}/${balances.length})`);
  }
  if (failures.length > 0) {
    logger.warn({ network, failures }, 'token api answered partially');
  }

  return {
    ok: failures.length === 0,
    stablecoinHolder: balances.some(
      (balance) =>
        balance.ok && (balance.data?.data ?? []).some((token) => Number(token.amount) > 0),
    ),
    nftHolder: (nfts.data?.data ?? []).length > 0,
    recentTransfer: (transfers.data?.data ?? []).length > 0,
    latencyMs,
    ...(failures.length > 0 ? { error: failures.join('; ') } : {}),
  };
}
