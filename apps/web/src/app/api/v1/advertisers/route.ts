import { z } from 'zod';
import { authenticate } from '@/server/modules/auth';
import { createAdvertiser } from '@/server/modules/advertisers/service';
import { json, parseBody, route } from '@/server/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  companyName: z.string().min(2).max(120),
  website: z.url().max(300).optional(),
});

/** Creating an advertiser profile is also what grants the advertiser role. */
export const POST = route(async (request) => {
  const { user } = await authenticate(request);
  const body = await parseBody(request, schema);
  return json(await createAdvertiser({ userId: user.id, ...body }));
});
