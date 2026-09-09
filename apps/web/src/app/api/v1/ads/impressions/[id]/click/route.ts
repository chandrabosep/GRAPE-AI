import { authenticate } from '@/server/modules/auth';
import { recordClick } from '@/server/modules/rewards/service';
import { json, newRequestId, toErrorResponse } from '@/server/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  ctx: RouteContext<'/api/v1/ads/impressions/[id]/click'>,
): Promise<Response> {
  const requestId = newRequestId();
  try {
    const { user } = await authenticate(request);
    const { id } = await ctx.params;
    return json(await recordClick(user.id, id));
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}
