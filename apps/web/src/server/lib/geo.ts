/**
 * Best-effort country for a request.
 *
 * Country is a targeting dimension, so not knowing it means a country-targeted
 * campaign correctly cannot reach that user — which is right for the advertiser
 * and bad for the user, who then sees fewer relevant ads and earns less. Hosting
 * platforms already resolve this at the edge, so read it rather than asking.
 *
 * Absent in local development, which is expected: the value stays null and
 * country-targeted campaigns simply do not match.
 */
const GEO_HEADERS = [
  'x-vercel-ip-country', // Vercel
  'cf-ipcountry', // Cloudflare
  'fly-client-ip-country', // Fly.io
  'x-country-code',
];

export function countryFromRequest(request: Request): string | null {
  for (const header of GEO_HEADERS) {
    const value = request.headers.get(header)?.trim().toUpperCase();
    if (value && /^[A-Z]{2}$/.test(value) && value !== 'XX') return value;
  }
  return null;
}
