import { AppError, bigintReplacer, type ErrorCode } from '@aam/shared';
import { ZodError, type ZodType } from 'zod';
import { logger } from './logger.js';
import { newRequestId } from './ids.js';

/**
 * Thin adapters between Next route handlers and the service modules.
 *
 * Route handlers stay a few lines each — parse, authorise, call a service,
 * respond — so the modules underneath remain testable without Next and could be
 * lifted into a standalone server later.
 */

/** Money is BigInt everywhere, so every response must serialise it as a string. */
export function json(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data, bigintReplacer), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...init?.headers,
    },
  });
}

export function errorResponse(code: ErrorCode, message: string, requestId?: string): Response {
  const error = new AppError(code, message);
  return json(error.toBody(requestId), { status: error.status });
}

/**
 * Turns anything thrown inside a handler into a correct HTTP response.
 * Unexpected errors are logged with an id and reported without internal detail.
 */
export function toErrorResponse(error: unknown, requestId: string): Response {
  if (error instanceof AppError) {
    return json(error.toBody(requestId), { status: error.status });
  }

  if (error instanceof ZodError) {
    const validation = new AppError('validation_failed', 'Request body is invalid', error.issues);
    return json(validation.toBody(requestId), { status: validation.status });
  }

  logger.error({ err: error, requestId }, 'unhandled error in route handler');
  const internal = new AppError('internal_error', 'Something went wrong');
  return json(internal.toBody(requestId), { status: internal.status });
}

/** Wraps a handler with a request id and uniform error handling. */
export function route(
  handler: (request: Request, requestId: string) => Promise<Response>,
): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    const requestId = newRequestId();
    try {
      return await handler(request, requestId);
    } catch (error) {
      return toErrorResponse(error, requestId);
    }
  };
}

export async function parseBody<T>(request: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new AppError('validation_failed', 'Request body must be valid JSON');
  }
  return schema.parse(raw);
}

export function parseQuery<T>(request: Request, schema: ZodType<T>): T {
  const url = new URL(request.url);
  return schema.parse(Object.fromEntries(url.searchParams));
}

/** Extracts a bearer token without revealing whether the header was malformed. */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
}
