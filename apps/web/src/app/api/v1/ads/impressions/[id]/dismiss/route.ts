import { authenticate } from '@/server/modules/auth';
import { recordDismiss } from '@/server/modules/rewards/service';
import { json, newRequestId, toErrorResponse } from '@/server/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  ctx: RouteContext<'/api/v1/ads/impressions/[id]/dismiss'>,
): Promise<Response> {
  const requestId = newRequestId();
  try {
    const { user } = await authenticate(request);
    const { id } = await ctx.params;
    await recordDismiss(user.id, id);
    return json({ ok: true });
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}
