import { authenticate } from '@/server/modules/auth';
import { requireAdvertiser } from '@/server/modules/advertisers/service';
import { json, route } from '@/server/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async (request) => {
  const { user } = await authenticate(request);
  return json(await requireAdvertiser(user.id));
});
