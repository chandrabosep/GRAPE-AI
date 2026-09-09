import { authenticate } from '@/server/modules/auth';
import { requireAdvertiser } from '@/server/modules/advertisers/service';
import { createCampaign, listCampaigns } from '@/server/modules/campaigns/service';
import { createCampaignSchema } from '@/server/modules/campaigns/schemas';
import { json, parseBody, route } from '@/server/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async (request) => {
  const { user } = await authenticate(request);
  const advertiser = await requireAdvertiser(user.id);
  return json(await listCampaigns(advertiser.id));
});

export const POST = route(async (request) => {
  const { user } = await authenticate(request);
  const advertiser = await requireAdvertiser(user.id);
  const body = await parseBody(request, createCampaignSchema);
  return json(await createCampaign(advertiser.id, body), { status: 201 });
});
