import { authenticate } from '@/server/modules/auth';
import { listModels } from '@/server/modules/ai/provider';
import { json, route } from '@/server/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The models this deployment can actually serve, with what each costs.
 *
 * Authenticated because the price per token is part of the answer, and the
 * picker in the client is driven entirely by this — nothing about the model
 * list is hardcoded on the client side.
 */
export const GET = route(async (request) => {
  await authenticate(request);
  return json({ models: listModels() });
});
