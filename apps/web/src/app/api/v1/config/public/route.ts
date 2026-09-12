import {
  AI_INTENTS,
  INTENT_CATEGORIES,
  INTERESTS,
  PERSONAS,
  TECHNOLOGIES,
} from '@aam/shared';
import { economics, env } from '@/server/config';
import { json, route } from '@/server/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Everything the clients need to render correct numbers, served from the same
 * config the engine uses. Nothing here is secret, and nothing economic is
 * hardcoded on the client as a result.
 */
export const GET = route(async () => {
  const config = economics();

  return json({
    allocation: config.allocation,
    /** The full ladder, so a client can show what is above a developer's rung. */
    tiers: config.tiers,
    credits: config.credits,
    chain: {
      id: env().CHAIN_ID,
      rpcUrl: env().RPC_URL,
      explorerUrl: env().EXPLORER_URL,
      campaignVault: env().CAMPAIGN_VAULT_ADDRESS ?? null,
      rewardPool: env().REWARD_POOL_ADDRESS ?? null,
      usdc: env().USDC_ADDRESS,
    },
    taxonomy: {
      categories: INTENT_CATEGORIES,
      intents: AI_INTENTS,
      technologies: TECHNOLOGIES,
      personas: PERSONAS,
      interests: INTERESTS,
    },
  });
});
