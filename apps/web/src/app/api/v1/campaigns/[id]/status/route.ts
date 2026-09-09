import { z } from 'zod';
import { authenticate } from '@/server/modules/auth';
import { requireAdvertiser } from '@/server/modules/advertisers/service';
import { transition } from '@/server/modules/campaigns/service';
import { json, newRequestId, parseBody, toErrorResponse } from '@/server/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  status: z.enum(['awaiting_funding', 'active', 'paused', 'ended']),
});

/**
 * Drives the campaign status machine. Illegal moves are rejected rather than
 * silently ignored, and activating runs the readiness checks so a campaign can
 * never go live with no creative or a budget below one bid.
 */
export async function POST(
  request: Request,
  ctx: RouteContext<'/api/v1/campaigns/[id]/status'>,
): Promise<Response> {
  const requestId = newRequestId();
  try {
    const { user } = await authenticate(request);
    const advertiser = await requireAdvertiser(user.id);
    const { id } = await ctx.params;
    const body = await parseBody(request, schema);
    return json(await transition(id, advertiser.id, body.status));
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}
