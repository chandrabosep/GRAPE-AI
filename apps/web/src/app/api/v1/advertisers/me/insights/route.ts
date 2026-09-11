import { z } from 'zod';
import { authenticate } from '@/server/modules/auth';
import { requireAdvertiser } from '@/server/modules/advertisers/service';
import { campaignInsights } from '@/server/modules/advertisers/insights';
import { json, parseQuery, route } from '@/server/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const querySchema = z.object({
  campaignId: z.string().max(64).optional(),
  /** Window length. Capped so one request cannot scan an unbounded history. */
  days: z.coerce.number().int().min(1).max(90).default(30),
});

export const GET = route(async (request) => {
  const { user } = await authenticate(request);
  const advertiser = await requireAdvertiser(user.id);
  const { campaignId, days } = parseQuery(request, querySchema);
  return json(await campaignInsights(advertiser.id, { campaignId, days }));
});
