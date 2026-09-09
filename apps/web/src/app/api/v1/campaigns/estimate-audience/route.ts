import { authenticate } from '@/server/modules/auth';
import { requireAdvertiser } from '@/server/modules/advertisers/service';
import { estimateAudience } from '@/server/modules/campaigns/service';
import { targetingSchema } from '@/server/modules/campaigns/schemas';
import { json, parseBody, route } from '@/server/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Live reach estimate for the campaign wizard. Returns aggregate counts only,
 * and suppresses them entirely below a floor so an estimate cannot be used to
 * identify anyone.
 */
export const POST = route(async (request) => {
  const { user } = await authenticate(request);
  await requireAdvertiser(user.id);
  const body = await parseBody(request, targetingSchema);
  return json(await estimateAudience(body));
});
