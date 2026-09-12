'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { api, clearSession, getAccessToken, storeSession } from '@/lib/api';

export interface Me {
  user: {
    id: string;
    email: string | null;
    displayName: string | null;
    countryCode: string | null;
    roles: string[];
    worldVerified: boolean;
  };
  profile: { persona: string | null; interests: string[]; technologies: string[] } | null;
  credits: { balanceMicro: string; withdrawableMicro: string };
  usageToday: { todayTokens: number; todayCostMicro: string; requestCount: number };
}

export interface SeedUser {
  subject: string;
  displayName: string | null;
  roles: string[];
  creditBalanceMicro: string;
}

export function useMe() {
  return useQuery<Me | null>({
    queryKey: ['me'],
    queryFn: async () => (getAccessToken() ? api<Me>('/me') : null),
  });
}

/** `seed:` accounts offered by the dev sign-in; empty unless one was made by hand. */
export function useSeedUsers() {
  return useQuery<SeedUser[]>({
    queryKey: ['seed-users'],
    queryFn: async () => {
      try {
        return await api<SeedUser[]>('/auth/dev/users');
      } catch {
        return [];
      }
    },
  });
}

export function useAuthActions() {
  const queryClient = useQueryClient();

  const signInAs = useCallback(
    async (subject: string) => {
      const session = await api<{ accessToken: string; refreshToken: string }>('/auth/dev', {
        method: 'POST',
        body: JSON.stringify({ subject }),
      });
      storeSession(session);
      await queryClient.invalidateQueries();
    },
    [queryClient],
  );

  const signOut = useCallback(async () => {
    clearSession();
    await queryClient.invalidateQueries();
  }, [queryClient]);

  return { signInAs, signOut };
}
