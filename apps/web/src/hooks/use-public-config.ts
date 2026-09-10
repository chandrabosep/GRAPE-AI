'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface PublicConfig {
  allocation: { reward: number; platform: number; treasury: number };
  credits: { starterGrantMicro: number; minPayoutMicro: number; maxRequestCostMicro: number };
  chain: {
    id: number;
    rpcUrl: string;
    explorerUrl: string;
    campaignVault: string | null;
    rewardPool: string | null;
    usdc: string | null;
  };
  taxonomy: {
    categories: string[];
    intents: string[];
    technologies: string[];
    personas: string[];
    interests: string[];
  };
}

/**
 * The taxonomy and economics come from the server, so the campaign form can
 * never offer a value the ranking engine does not recognise, and no percentage
 * is hardcoded in the browser.
 */
export function usePublicConfig() {
  return useQuery<PublicConfig>({
    queryKey: ['public-config'],
    queryFn: () => api<PublicConfig>('/config/public'),
    staleTime: 5 * 60 * 1000,
  });
}
