import { AppError } from '@aam/shared';
import { env, requireEnv } from '../../config/index.js';
import { logger } from '../../lib/logger.js';

/**
 * Privy is the identity layer for both surfaces.
 *
 * The browser authenticates with Privy and gets an embedded wallet without ever
 * seeing a seed phrase; we verify the resulting access token here and key our
 * own user record off the Privy DID. The extension never talks to Privy at all
 * — it exchanges a one-time code for our own session, so no wallet or Privy
 * credential is ever handled inside the editor.
 */

export interface PrivyIdentity {
  did: string;
  email: string | null;
}

/** Lazily constructed so the app boots and runs without Privy keys configured. */
let clientPromise: Promise<PrivyClientLike> | null = null;

interface PrivyClientLike {
  utils(): {
    auth(): {
      verifyAccessToken(input: { access_token: string }): Promise<{ userId: string }>;
    };
  };
  users(): {
    _get(userId: string): Promise<unknown>;
  };
}

async function getClient(): Promise<PrivyClientLike> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const { PrivyClient } = await import('@privy-io/node');
      return new PrivyClient({
        appId: requireEnv('PRIVY_APP_ID'),
        appSecret: requireEnv('PRIVY_APP_SECRET'),
        ...(env().PRIVY_JWT_VERIFICATION_KEY
          ? { jwtVerificationKey: env().PRIVY_JWT_VERIFICATION_KEY }
          : {}),
      }) as unknown as PrivyClientLike;
    })();
  }
  return clientPromise;
}

export function isPrivyConfigured(): boolean {
  return Boolean(env().PRIVY_APP_ID && env().PRIVY_APP_SECRET);
}

/**
 * Verifies a Privy access token and returns the identity we key users off.
 *
 * The DID is the stable identifier; email is best-effort and only used for
 * display, so a token without one is still perfectly valid.
 */
export async function verifyPrivyToken(accessToken: string): Promise<PrivyIdentity> {
  if (!isPrivyConfigured()) {
    throw new AppError(
      'upstream_unavailable',
      'Privy is not configured on this server. Set PRIVY_APP_ID and PRIVY_APP_SECRET.',
    );
  }

  try {
    const client = await getClient();
    const claims = await client.utils().auth().verifyAccessToken({ access_token: accessToken });

    let email: string | null = null;
    try {
      const user = (await client.users()._get(claims.userId)) as
        | { email?: { address?: string } | null; linked_accounts?: { type: string; address?: string }[] }
        | null;
      email =
        user?.email?.address ??
        user?.linked_accounts?.find((a) => a.type === 'email')?.address ??
        null;
    } catch (error) {
      // A profile lookup failure must not block sign-in; the token already proved identity.
      logger.warn({ err: error }, 'privy profile lookup failed, continuing without email');
    }

    return { did: claims.userId, email };
  } catch (error) {
    if (error instanceof AppError) throw error;
    logger.warn({ err: error }, 'privy token verification failed');
    throw new AppError('unauthorized', 'Could not verify your Privy session');
  }
}
