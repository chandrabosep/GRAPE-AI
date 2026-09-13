import { z } from 'zod';
import { authenticate } from '@/server/modules/auth';
import { requireAdvertiser } from '@/server/modules/advertisers/service';
import { fundingState, recordFunding, type FundingState } from '@/server/modules/campaigns/funding';
import { json, newRequestId, parseBody, toErrorResponse } from '@/server/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Micro amounts are bigint server-side and decimal strings on the wire. */
function wire(state: FundingState) {
  return {
    ...state,
    budgetMicro: state.budgetMicro.toString(),
    depositedMicro: state.depositedMicro.toString(),
    settledMicro: state.settledMicro.toString(),
    outstandingMicro: state.outstandingMicro.toString(),
  };
}

/**
 * What the vault holds for this campaign, and everything the browser needs to
 * add to it: the key, the vault and token addresses, and the outstanding amount.
 */
export async function GET(
  request: Request,
  ctx: RouteContext<'/api/v1/campaigns/[id]/funding'>,
): Promise<Response> {
  const requestId = newRequestId();
  try {
    const { user } = await authenticate(request);
    const advertiser = await requireAdvertiser(user.id);
    const { id } = await ctx.params;
    return json(wire(await fundingState(id, advertiser.id)));
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}

const schema = z.object({
  /** The `fund` transaction the browser just sent. Recorded, never trusted. */
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'Expected a transaction hash'),
});

/**
 * Files the receipt for a deposit and returns the vault's own tally.
 *
 * The response is read back off the chain rather than derived from the hash, so
 * a client that posts a stale or foreign receipt learns nothing it did not
 * already know and gains no budget it did not deposit.
 */
export async function POST(
  request: Request,
  ctx: RouteContext<'/api/v1/campaigns/[id]/funding'>,
): Promise<Response> {
  const requestId = newRequestId();
  try {
    const { user } = await authenticate(request);
    const advertiser = await requireAdvertiser(user.id);
    const { id } = await ctx.params;
    const body = await parseBody(request, schema);
    return json(wire(await recordFunding(id, advertiser.id, body.txHash)));
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}
