import { authenticate } from '@/server/modules/auth';
import { requireAdvertiser } from '@/server/modules/advertisers/service';
import { getCampaign } from '@/server/modules/campaigns/service';
import { json, newRequestId, toErrorResponse } from '@/server/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  ctx: RouteContext<'/api/v1/campaigns/[id]'>,
): Promise<Response> {
  const requestId = newRequestId();
  try {
    const { user } = await authenticate(request);
    const advertiser = await requireAdvertiser(user.id);
    const { id } = await ctx.params;
    return json(await getCampaign(id, advertiser.id));
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}
