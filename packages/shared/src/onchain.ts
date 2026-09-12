import { z } from 'zod';

/**
 * Audience signals derived from onchain history via The Graph.
 *
 * Produced by GraphAudienceService from Messari standardized subgraphs (one
 * query shape across many lending/DEX protocols), the Token API, and the ENS
 * subgraph. Categorical by design: advertisers target these booleans and
 * protocol slugs, never an address or a balance.
 */
export const onchainSignalsSchema = z.object({
  walletActivity: z.boolean(),
  ethereumActivity: z.boolean(),
  lendingActivity: z.boolean(),
  dexActivity: z.boolean(),
  defiActivity: z.boolean(),
  nftHolder: z.boolean(),
  ensHolder: z.boolean(),
  stablecoinHolder: z.boolean(),
  /** Protocol slugs the wallet interacted with, e.g. ["aave-v3", "uniswap-v3"]. */
  protocols: z.array(z.string().max(64)).max(50),
  protocolTypes: z.array(z.enum(['lending', 'dex'])).max(4),
  chains: z.array(z.string().max(32)).max(20),
  lastActivityDaysAgo: z.number().int().min(0).nullable(),
  /** 0..1 recency+breadth composite used as a soft ranking boost. */
  activityScore: z.number().min(0).max(1),
  windowDays: z.number().int().positive(),
});
export type OnchainSignals = z.infer<typeof onchainSignalsSchema>;

/** Provenance: which Graph product answered which field. Shown in the demo and README. */
export const signalSourceSchema = z.object({
  product: z.enum(['standardized-subgraph', 'token-api', 'subgraph', 'subgraph-mcp', 'substreams']),
  reference: z.string().max(200),
  ok: z.boolean(),
  latencyMs: z.number().int().nonnegative().optional(),
  error: z.string().max(300).optional(),
});
export type SignalSource = z.infer<typeof signalSourceSchema>;

/** What an advertiser configures on a campaign. Every field is optional and additive. */
export const onchainCriteriaSchema = z.object({
  requireWalletActivity: z.boolean().default(false),
  protocolTypes: z.array(z.enum(['lending', 'dex'])).max(4).default([]),
  protocols: z.array(z.string().max(64)).max(20).default([]),
  activityWindowDays: z.number().int().min(1).max(365).default(30),
  requireEnsHolder: z.boolean().default(false),
  requireStablecoinHolder: z.boolean().default(false),
  requireNftHolder: z.boolean().default(false),
  chains: z.array(z.string().max(32)).max(10).default(['mainnet']),
});
export type OnchainCriteria = z.infer<typeof onchainCriteriaSchema>;

/**
 * off   — ignore onchain entirely (campaign reaches users with no linked wallet)
 * boost — unmatched users still eligible, matched users score higher
 * require — a user must satisfy every criterion, missing signals mean ineligible
 */
export const onchainModeSchema = z.enum(['off', 'boost', 'require']);
export type OnchainMode = z.infer<typeof onchainModeSchema>;

export const EMPTY_ONCHAIN_CRITERIA: OnchainCriteria = {
  requireWalletActivity: false,
  protocolTypes: [],
  protocols: [],
  activityWindowDays: 30,
  requireEnsHolder: false,
  requireStablecoinHolder: false,
  requireNftHolder: false,
  chains: ['mainnet'],
};
