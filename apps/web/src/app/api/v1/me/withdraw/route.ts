import { z } from 'zod';
import { authenticate } from '@/server/modules/auth';
import { withdrawableMicro } from '@/server/modules/credits/service';
import { withdraw } from '@/server/modules/payouts/service';
import { json, route } from '@/server/lib/http';
import { env } from '@/server/config/index';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  /** Micro-USD, matching the ledger. 1_000_000 = $1.00. */
  amountMicro: z.coerce.bigint().positive(),
  to: z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'Expected an EVM address'),
});

/** What the withdraw page needs to render before anything is submitted. */
export const GET = route(async (request) => {
  const { user } = await authenticate(request);

  return json({
    withdrawableMicro: await withdrawableMicro(user.id),
    asset: { address: env().USDC_ADDRESS, symbol: 'USDC', decimals: 6 },
    chainId: env().CHAIN_ID,
    explorerUrl: env().EXPLORER_URL,
    enabled: Boolean(env().REWARD_POOL_ADDRESS && env().OPERATOR_PRIVATE_KEY),
  });
});

/**
 * Pays earned credits out as USDC on Hedera.
 *
 * Only credits that were *earned* can leave as money — `debitPayout` enforces
 * that inside the ledger transaction, so purchased credits are spendable on
 * inference but never withdrawable, which keeps this from being a way to move
 * money through the product.
 */
export const POST = route(async (request) => {
  const { user } = await authenticate(request);
  const body = bodySchema.parse(await request.json());

  const result = await withdraw({
    userId: user.id,
    amountMicro: body.amountMicro,
    to: body.to,
  });

  return json({
    payoutId: result.payoutId,
    txHash: result.txHash,
    amountMicro: result.amountMicro,
    to: result.to,
    explorerUrl: result.explorerUrl,
  });
});
