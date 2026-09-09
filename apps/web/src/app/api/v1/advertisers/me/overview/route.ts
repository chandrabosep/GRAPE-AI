import { authenticate } from '@/server/modules/auth';
import { advertiserOverview, requireAdvertiser } from '@/server/modules/advertisers/service';
import { json, route } from '@/server/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async (request) => {
  const { user } = await authenticate(request);
  const advertiser = await requireAdvertiser(user.id);
  return json(await advertiserOverview(advertiser.id));
});
