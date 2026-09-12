import { authenticate } from '@/server/modules/auth';
import { withdrawableMicro } from '@/server/modules/credits/service';
import { getTierStanding } from '@/server/modules/tiers/service';
import { usageSummary } from '@/server/modules/usage/service';
import { json, route } from '@/server/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async (request) => {
  const { user } = await authenticate(request);

  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  const [withdrawable, usage, standing] = await Promise.all([
    withdrawableMicro(user.id),
    usageSummary(user.id, startOfDay),
    getTierStanding(user.id),
  ]);

  return json({
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      countryCode: user.countryCode,
      roles: user.roles,
      worldVerified: user.worldVerified,
    },
    profile: user.profile,
    credits: {
      balanceMicro: user.creditBalanceMicro,
      withdrawableMicro: withdrawable,
    },
    usageToday: usage,
    // The whole standing, not just the tier: a ladder the client has to
    // reassemble from the public config and a bare level is a ladder that
    // renders differently in each client.
    tier: standing,
  });
});
