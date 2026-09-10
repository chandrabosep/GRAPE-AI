import { authenticate } from '@/server/modules/auth';
import { listTransactions, withdrawableMicro } from '@/server/modules/credits/service';
import { getBalance } from '@/server/modules/credits/service';
import { json, route } from '@/server/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The credit ledger, as the user sees it.
 *
 * Every movement is here with its reason, because a balance nobody can explain
 * is not a balance anyone will trust.
 */
export const GET = route(async (request) => {
  const { user } = await authenticate(request);

  const [balanceMicro, withdrawable, transactions] = await Promise.all([
    getBalance(user.id),
    withdrawableMicro(user.id),
    listTransactions(user.id, { limit: 50 }),
  ]);

  return json({
    balanceMicro,
    withdrawableMicro: withdrawable,
    transactions: transactions.map((tx) => ({
      id: tx.id,
      type: tx.type,
      amountMicro: tx.amountMicro,
      balanceAfterMicro: tx.balanceAfterMicro,
      refType: tx.refType,
      createdAt: tx.createdAt,
    })),
  });
});
