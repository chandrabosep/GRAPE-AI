import { json } from '@/server/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return json({ status: 'ok', time: new Date().toISOString() });
}
