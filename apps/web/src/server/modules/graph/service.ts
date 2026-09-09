import { prisma } from '@aam/db';
import type { OnchainSignals, SignalSource } from '@aam/shared';
import { economics, env } from '../../config/index';
import { logger } from '../../lib/logger';
import { queryEnsOwnership, queryProtocolTouch, type ProtocolTouch } from './queries';
import { ENS_SUBGRAPH_ID, sourcesForChains, type SubgraphSource } from './sources';
import { fetchTokenApiSignals } from './token-api';

/**
 * GraphAudienceService — the onchain half of targeting.
 *
 * This is where The Graph is load-bearing rather than decorative. Without it the
 * onchain term in the ranking engine is always zero, campaigns in "require" mode
 * are never eligible, and an advertiser asking for "developers who actually use
 * DeFi" has no way to express that. Turning a campaign's onchain criterion on or
 * off visibly changes which ad wins.
 *
 * Two Graph products are composed. Standardized Messari subgraphs answer
 * protocol interaction with one query shape across many protocols; the Token API
 * answers holdings and recent movement, which the subgraph layer cannot. ENS is
 * a third, small source.
 *
 * Every source is allowed to fail. A partial answer is far more useful than none,
 * so failures are recorded in the provenance rather than thrown, and the caller
 * can see exactly which product answered which field.
 */

const DAY_SECONDS = 86_400;

export interface AudienceResult {
  signals: OnchainSignals;
  sources: SignalSource[];
}

function emptySignals(windowDays: number): OnchainSignals {
  return {
    walletActivity: false,
    ethereumActivity: false,
    lendingActivity: false,
    dexActivity: false,
    defiActivity: false,
    nftHolder: false,
    ensHolder: false,
    stablecoinHolder: false,
    protocols: [],
    protocolTypes: [],
    chains: [],
    lastActivityDaysAgo: null,
    activityScore: 0,
    windowDays,
  };
}

/**
 * Recency and breadth, combined into one number the ranking engine can use as a
 * soft boost. A wallet active yesterday across three protocols should outrank
 * one that touched a single protocol a month ago.
 */
export function computeActivityScore(protocolCount: number, lastActivityDaysAgo: number | null, windowDays: number): number {
  if (protocolCount === 0) return 0;

  const breadth = Math.min(1, protocolCount / 3);
  const recency =
    lastActivityDaysAgo === null ? 0.5 : Math.max(0, 1 - lastActivityDaysAgo / windowDays);

  return Number((0.6 * recency + 0.4 * breadth).toFixed(3));
}

/**
 * Computes fresh signals for one address.
 *
 * Subgraphs are queried in parallel with allSettled: one slow or broken
 * deployment must not decide whether an ad is shown at all.
 */
export async function computeSignals(
  address: string,
  options: { windowDays?: number; chains?: string[] } = {},
): Promise<AudienceResult> {
  const windowDays = options.windowDays ?? 30;
  const chains = options.chains ?? ['mainnet', 'base'];
  const since = Math.floor(Date.now() / 1000) - windowDays * DAY_SECONDS;
  const sinceIso = new Date(since * 1000).toISOString().slice(0, 10);

  const subgraphSources: SubgraphSource[] = sourcesForChains(chains);
  const sources: SignalSource[] = [];

  const [touches, ens, tokenApi] = await Promise.all([
    Promise.allSettled(subgraphSources.map((source) => queryProtocolTouch(source, address, since))),
    queryEnsOwnership(ENS_SUBGRAPH_ID, address).catch(() => null),
    fetchTokenApiSignals(address, chains[0] ?? 'mainnet', sinceIso).catch(() => null),
  ]);

  const signals = emptySignals(windowDays);
  const protocols = new Set<string>();
  const protocolTypes = new Set<'lending' | 'dex'>();
  const activeChains = new Set<string>();
  let mostRecent: number | null = null;

  for (const [index, settled] of touches.entries()) {
    const source = subgraphSources[index]!;

    if (settled.status !== 'fulfilled') {
      sources.push({
        product: 'standardized-subgraph',
        reference: `messari.${source.type}.${source.key}`,
        ok: false,
        error: 'query rejected',
      });
      continue;
    }

    const touch: ProtocolTouch = settled.value;
    sources.push({
      product: 'standardized-subgraph',
      reference: `messari.${source.type}.${source.key}`,
      ok: touch.ok,
      latencyMs: touch.latencyMs,
      ...(touch.error ? { error: touch.error } : {}),
    });

    if (!touch.ok || !touch.touched) continue;

    protocols.add(source.protocol);
    protocolTypes.add(source.type);
    activeChains.add(source.chain);
    if (touch.lastActivityAt !== null) {
      mostRecent = mostRecent === null ? touch.lastActivityAt : Math.max(mostRecent, touch.lastActivityAt);
    }
  }

  if (ens) {
    sources.push({
      product: 'subgraph',
      reference: 'ens',
      ok: ens.ok,
      latencyMs: ens.latencyMs,
      ...(ens.error ? { error: ens.error } : {}),
    });
    signals.ensHolder = ens.holder;
  }

  if (tokenApi) {
    sources.push({
      product: 'token-api',
      reference: 'pinax.balances+transfers+nft',
      ok: tokenApi.ok,
      latencyMs: tokenApi.latencyMs,
      ...(tokenApi.error ? { error: tokenApi.error } : {}),
    });
    signals.stablecoinHolder = tokenApi.stablecoinHolder;
    signals.nftHolder = tokenApi.nftHolder;
    if (tokenApi.recentTransfer) activeChains.add(chains[0] ?? 'mainnet');
  }

  signals.protocols = [...protocols];
  signals.protocolTypes = [...protocolTypes];
  signals.chains = [...activeChains];
  signals.lendingActivity = protocolTypes.has('lending');
  signals.dexActivity = protocolTypes.has('dex');
  signals.defiActivity = signals.lendingActivity || signals.dexActivity;
  signals.ensHolder = signals.ensHolder || false;

  signals.lastActivityDaysAgo =
    mostRecent === null ? null : Math.floor((Date.now() / 1000 - mostRecent) / DAY_SECONDS);

  signals.walletActivity =
    signals.defiActivity ||
    signals.ensHolder ||
    signals.nftHolder ||
    signals.stablecoinHolder ||
    (tokenApi?.recentTransfer ?? false);

  signals.ethereumActivity = signals.walletActivity && activeChains.has('mainnet');
  signals.activityScore = computeActivityScore(protocols.size, signals.lastActivityDaysAgo, windowDays);

  return { signals, sources };
}

/**
 * Cached signals for a user, refreshed when stale.
 *
 * Ad selection is on the hot path of every chat request, so this must never make
 * a network call when a usable answer already exists. On any failure it returns
 * the last good value rather than nothing: stale targeting beats no targeting.
 */
export async function getSignalsForUser(userId: string): Promise<OnchainSignals | null> {
  const wallet = await prisma.wallet.findFirst({
    where: { userId, isPrimarySignalSource: true, verifiedAt: { not: null } },
    include: { signals: true },
  });

  if (!wallet) return null;

  const cached = wallet.signals;
  if (cached && cached.expiresAt > new Date()) {
    return cached.signals as unknown as OnchainSignals;
  }

  try {
    return await refreshSignalsForWallet(userId, wallet.id, wallet.address);
  } catch (error) {
    logger.warn({ err: error, userId }, 'signal refresh failed, using cached value');
    return (cached?.signals as unknown as OnchainSignals) ?? null;
  }
}

export async function refreshSignalsForWallet(
  userId: string,
  walletId: string,
  address: string,
): Promise<OnchainSignals> {
  const { signals, sources } = await computeSignals(address);
  const expiresAt = new Date(Date.now() + economics().signalCacheHours * 60 * 60 * 1000);

  await prisma.onchainSignal.upsert({
    where: { walletId },
    create: {
      userId,
      walletId,
      signals: signals as unknown as object,
      sources: sources as unknown as object,
      computedAt: new Date(),
      expiresAt,
    },
    update: {
      signals: signals as unknown as object,
      sources: sources as unknown as object,
      computedAt: new Date(),
      expiresAt,
    },
  });

  return signals;
}

/** True when the audience service has the credentials it needs to run. */
export function isGraphConfigured(): boolean {
  return Boolean(env().GRAPH_GATEWAY_API_KEY);
}
