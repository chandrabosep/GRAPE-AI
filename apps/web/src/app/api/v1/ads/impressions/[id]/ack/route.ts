import { adAckRequestSchema } from '@aam/shared';
import { authenticate } from '@/server/modules/auth';
import { confirmImpression } from '@/server/modules/rewards/service';
import { json, newRequestId, parseBody, toErrorResponse } from '@/server/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The client confirms the sponsored card was actually on screen.
 *
 * This is the only thing that turns an impression into money. Selecting an ad
 * costs the advertiser nothing until attention is evidenced here.
 */
export async function POST(
  request: Request,
  ctx: RouteContext<'/api/v1/ads/impressions/[id]/ack'>,
): Promise<Response> {
  const requestId = newRequestId();
  try {
    const { user } = await authenticate(request);
    const { id } = await ctx.params;
    const body = await parseBody(request, adAckRequestSchema);

    const outcome = await confirmImpression(user.id, id, body.visibleMs);
    return json(outcome);
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}
