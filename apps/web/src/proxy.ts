import { NextResponse, type NextRequest } from 'next/server';

/**
 * CORS for the API.
 *
 * Next 16 renamed middleware to proxy. The VS Code extension is not a browser
 * origin, so it sends no Origin header and a wildcard is the correct answer for
 * it. Credentials are never carried in cookies for the API — every client sends
 * a bearer token — so a wildcard here does not widen anything.
 */
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

export function proxy(request: NextRequest) {
  if (request.method === 'OPTIONS') {
    return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
  }

  const response = NextResponse.next();
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    response.headers.set(key, value);
  }
  return response;
}

export const config = {
  matcher: '/api/:path*',
};
