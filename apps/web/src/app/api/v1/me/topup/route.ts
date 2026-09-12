import { z } from 'zod';
import { authenticate } from '@/server/modules/auth';
import { getBalance } from '@/server/modules/credits/service';
import { redeemTopup, treasuryEvmAddress } from '@/server/modules/payouts/topup';
import { json, route } from '@/server/lib/http';
import { env } from '@/server/config/index';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  /** An EVM hash, or a Hedera transaction id in either `0.0.x@s.n` or `0.0.x-s-n` form. */
  txId: z.string().min(5).max(120),
});

/**
 * Everything the page needs to send the payment itself.
 *
 * The EVM address and token address are here — not just the Hedera ids —
 * because the browser pays by calling `transfer` on the token contract from the
 * user's own wallet. The Hedera ids stay alongside them for the fallback where
 * someone sends from an app that speaks account ids.
 */
export const GET = route(async (request) => {
  const { user } = await authenticate(request);

  const configured = Boolean(env().TREASURY_ACCOUNT_ID);

  return json({
    balanceMicro: await getBalance(user.id),
    treasuryAccountId: env().TREASURY_ACCOUNT_ID ?? null,
    treasuryAddress: configured ? await treasuryEvmAddress() : null,
    token: {
      id: env().USDC_TOKEN_ID,
      address: env().USDC_ADDRESS,
      symbol: 'USDC',
      decimals: 6,
    },
    network: 'hedera:testnet',
    chainId: env().CHAIN_ID,
    rpcUrl: env().RPC_URL,
    explorerUrl: env().EXPLORER_URL,
    enabled: configured,
  });
});

/**
 * Credits a transfer the user has sent on chain.
 *
 * Normally the browser posts the hash the moment the wallet returns it, so this
 * runs while the user is still watching a spinner. It is verified against the
 * mirror node rather than trusted, and crediting the same transfer twice is
 * blocked by the unique constraint on `payments.tx_id` — a database guarantee
 * rather than a check someone has to remember to write.
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
