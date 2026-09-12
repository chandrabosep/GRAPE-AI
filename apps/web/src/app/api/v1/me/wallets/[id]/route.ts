import { authenticate } from '@/server/modules/auth';
import { unlinkWallet } from '@/server/modules/wallets/service';
import { json, newRequestId, toErrorResponse } from '@/server/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Unlinks a wallet, taking its cached signals with it.
 *
 * The counterpart to linking, and not optional: a user who can hand us a signal
 * source has to be able to take it back, and deleting the wallet is what
 * actually deletes the derived signals (by cascade) rather than merely hiding
 * them from targeting.
 */
export async function DELETE(
  request: Request,
  ctx: RouteContext<'/api/v1/me/wallets/[id]'>,
): Promise<Response> {
  const requestId = newRequestId();
  try {
    const { user } = await authenticate(request);
    const { id } = await ctx.params;
    await unlinkWallet(user.id, id);
    return json({ ok: true });
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}
