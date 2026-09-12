import { z } from 'zod';
import { authenticate } from '@/server/modules/auth';
import { getBalance } from '@/server/modules/credits/service';
import { redeemTopup } from '@/server/modules/payouts/topup';
import { json, route } from '@/server/lib/http';
import { env } from '@/server/config/index';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  /** Hedera transaction id, in either `0.0.x@s.n` or `0.0.x-s-n` form. */
  txId: z.string().min(5).max(120),
});

/** Where to send, and what to send, so the page can render instructions. */
export const GET = route(async (request) => {
  const { user } = await authenticate(request);

  return json({
    balanceMicro: await getBalance(user.id),
    treasuryAccountId: env().TREASURY_ACCOUNT_ID ?? null,
    token: { id: env().USDC_TOKEN_ID, symbol: 'USDC', decimals: 6 },
    network: 'hedera:testnet',
    explorerUrl: env().EXPLORER_URL,
    enabled: Boolean(env().TREASURY_ACCOUNT_ID),
  });
});

/**
 * Credits a top-up the user has already sent on chain.
 *
 * The transaction is verified against the mirror node rather than trusted, and
 * crediting the same transfer twice is blocked by the unique constraint on
 * `payments.tx_id` — a database guarantee rather than a check someone has to
 * remember to write.
 */
export const POST = route(async (request) => {
  const { user } = await authenticate(request);
  const body = bodySchema.parse(await request.json());

  const result = await redeemTopup(user.id, body.txId);

  return json({
    creditedMicro: result.creditedMicro,
    balanceMicro: result.balanceMicro,
    txId: result.txId,
  });
});
