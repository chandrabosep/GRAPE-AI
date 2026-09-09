import { linkWalletRequestSchema } from '@aam/shared';
import { authenticate } from '@/server/modules/auth';
import { linkWallet, listWallets } from '@/server/modules/wallets/service';
import { json, parseBody, route } from '@/server/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async (request) => {
  const { user } = await authenticate(request);
  return json(await listWallets(user.id));
});

/**
 * Links a wallet as the targeting signal source, after verifying the user
 * actually controls it.
 */
export const POST = route(async (request) => {
  const { user } = await authenticate(request);
  const body = await parseBody(request, linkWalletRequestSchema);
  return json(await linkWallet({ userId: user.id, ...body }), { status: 201 });
});
