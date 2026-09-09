import { authenticate } from '@/server/modules/auth';
import { explainImpression } from '@/server/modules/rewards/service';
import { json, newRequestId, toErrorResponse } from '@/server/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * "Why this ad?" — the user sees exactly the categorical signals that were used
 * to target them, and nothing else exists to show.
 */
export async function GET(
  request: Request,
  ctx: RouteContext<'/api/v1/ads/impressions/[id]/why'>,
): Promise<Response> {
  const requestId = newRequestId();
  try {
    const { user } = await authenticate(request);
    const { id } = await ctx.params;
    return json({ reasons: await explainImpression(user.id, id) });
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}
