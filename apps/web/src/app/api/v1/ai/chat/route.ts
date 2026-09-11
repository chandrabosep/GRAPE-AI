import { chatRequestSchema } from '@aam/shared';
import { authenticate } from '@/server/modules/auth';
import { handleChat } from '@/server/modules/ai/chat';
import { newRequestId, parseBody, toErrorResponse } from '@/server/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Long enough for a full answer, bounded so a hung upstream cannot pin a worker.
export const maxDuration = 120;

/**
 * The core endpoint. Returns an SSE stream carrying the answer, the derived
 * intent, the sponsored card and the usage report as separate events.
 */
export async function POST(request: Request): Promise<Response> {
  const requestId = newRequestId();
  try {
    const { user } = await authenticate(request);
    const body = await parseBody(request, chatRequestSchema);

    return handleChat(body, {
      user,
      sessionId: body.sessionId ?? null,
      client: 'web',
      requestId,
      adsEnabled: true,
      signal: request.signal,
    });
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}
