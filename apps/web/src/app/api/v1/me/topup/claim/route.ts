import { authenticate } from '@/server/modules/auth';
import { getBalance } from '@/server/modules/credits/service';
import { claimTransfers } from '@/server/modules/payouts/topup';
import { json, route } from '@/server/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Credits USDC the user has already sent to the treasury but never claimed.
 *
 * The page calls this on load and after every payment, so a top-up that lost
 * its receipt — a closed tab, a wallet that returned nothing, a send made from
 * a phone — still lands without anyone typing a transaction id. It is safe to
 * call repeatedly: anything already credited is skipped.
 */
export const POST = route(async (request) => {
  const { user } = await authenticate(request);

  const result = await claimTransfers(user.id);

  return json({
    claimed: result.claimed.map((entry) => ({
      txId: entry.txId,
      creditedMicro: entry.creditedMicro,
    })),
    creditedMicro: result.creditedMicro,
    balanceMicro: result.balanceMicro ?? (await getBalance(user.id)),
  });
});
