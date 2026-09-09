import { z } from 'zod';
import { revokeSession } from '@/server/modules/auth';
import { json, parseBody, route } from '@/server/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ refreshToken: z.string().min(10) });

export const POST = route(async (request) => {
  const body = await parseBody(request, schema);
  await revokeSession(body.refreshToken);
  return json({ ok: true });
});
