import { authenticate } from '@/server/modules/auth';
import { refreshWalletSignals } from '@/server/modules/wallets/service';
import { json, newRequestId, toErrorResponse } from '@/server/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Recomputes and returns the signals derived from this wallet.
 *
 * Deliberately user-facing: this is the whole set of things an advertiser can
 * target the user on, so they can see it and refresh it themselves.
 */
export async function POST(
  request: Request,
  ctx: RouteContext<'/api/v1/me/wallets/[id]/refresh-signals'>,
): Promise<Response> {
  const requestId = newRequestId();
  try {
    const { user } = await authenticate(request);
    const { id } = await ctx.params;
    return json({ signals: await refreshWalletSignals(user.id, id) });
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}
