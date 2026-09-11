import { authenticate } from '@/server/modules/auth';
import { requireAdvertiser } from '@/server/modules/advertisers/service';
import { deleteCreative, upsertCreative } from '@/server/modules/campaigns/service';
import { creativeSchema } from '@/server/modules/campaigns/schemas';
import { errorResponse, json, newRequestId, parseBody, toErrorResponse } from '@/server/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PUT(
  request: Request,
  ctx: RouteContext<'/api/v1/campaigns/[id]/creative'>,
): Promise<Response> {
  const requestId = newRequestId();
  try {
    const { user } = await authenticate(request);
    const advertiser = await requireAdvertiser(user.id);
    const { id } = await ctx.params;
    const body = await parseBody(request, creativeSchema);
    return json(await upsertCreative(id, advertiser.id, body));
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}

export async function DELETE(
  request: Request,
  ctx: RouteContext<'/api/v1/campaigns/[id]/creative'>,
): Promise<Response> {
  const requestId = newRequestId();
  try {
    const { user } = await authenticate(request);
    const advertiser = await requireAdvertiser(user.id);
    const { id } = await ctx.params;
    const format = new URL(request.url).searchParams.get('format');
    if (format !== 'banner' && format !== 'inline') {
      return errorResponse('validation_failed', 'format must be banner or inline', requestId);
    }
    return json(await deleteCreative(id, advertiser.id, format));
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}
