import { prisma, type ClientKind } from '@aam/db';
import { AppError } from '@aam/shared';
import { SignJWT, jwtVerify } from 'jose';
import { env } from '../../config/index';
import { newOpaqueToken, sha256 } from '../../lib/ids';

/**
 * Our own sessions, independent of Privy.
 *
 * A short-lived access token is checked on every request without a database
 * round trip; a long-lived refresh token is stored hashed and rotated on use,
 * so a leaked refresh token is usable at most once before it is detectably
 * invalid. The extension holds these, never a Privy credential.
 */

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const REFRESH_TOKEN_TTL_DAYS = 30;
const ISSUER = 'ai-attention-marketplace';

export interface SessionClaims {
  userId: string;
  client: ClientKind;
  sessionId: string;
}

export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
}

function secret(): Uint8Array {
  return new TextEncoder().encode(env().JWT_SECRET);
}

async function signAccessToken(claims: SessionClaims): Promise<string> {
  return new SignJWT({ client: claims.client, sid: claims.sessionId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.userId)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(secret());
}

export async function verifyAccessToken(token: string): Promise<SessionClaims> {
  try {
    const { payload } = await jwtVerify(token, secret(), { issuer: ISSUER });
    if (!payload.sub || typeof payload.client !== 'string' || typeof payload.sid !== 'string') {
      throw new Error('malformed claims');
    }
    return {
      userId: payload.sub,
      client: payload.client as ClientKind,
      sessionId: payload.sid,
    };
  } catch {
    throw new AppError('unauthorized', 'Your session has expired. Sign in again.');
  }
}

/** Creates a session row and returns both tokens. The refresh token is stored hashed. */
export async function issueSession(
  userId: string,
  client: ClientKind,
  userAgent?: string,
): Promise<IssuedSession> {
  const refreshToken = newOpaqueToken();
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  const session = await prisma.apiSession.create({
    data: {
      userId,
      client,
      refreshTokenHash: sha256(refreshToken),
      expiresAt,
      userAgent: userAgent ?? null,
    },
  });

  const accessToken = await signAccessToken({ userId, client, sessionId: session.id });
  return { accessToken, refreshToken, expiresInSeconds: ACCESS_TOKEN_TTL_SECONDS };
}

/**
 * Exchanges a refresh token for a new pair and invalidates the old one.
 *
 * Rotation is what makes a stolen refresh token low-value: the first use wins
 * and the second fails, which also surfaces the theft.
 */
export async function rotateSession(refreshToken: string, userAgent?: string): Promise<IssuedSession> {
  const hash = sha256(refreshToken);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.apiSession.findUnique({ where: { refreshTokenHash: hash } });

    if (!existing || existing.revokedAt || existing.expiresAt < new Date()) {
      throw new AppError('unauthorized', 'Your session has expired. Sign in again.');
    }

    await tx.apiSession.update({
      where: { id: existing.id },
      data: { revokedAt: new Date() },
    });

    const nextRefresh = newOpaqueToken();
    const session = await tx.apiSession.create({
      data: {
        userId: existing.userId,
        client: existing.client,
        refreshTokenHash: sha256(nextRefresh),
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000),
        userAgent: userAgent ?? existing.userAgent,
      },
    });

    const accessToken = await signAccessToken({
      userId: existing.userId,
      client: existing.client,
      sessionId: session.id,
    });

    return { accessToken, refreshToken: nextRefresh, expiresInSeconds: ACCESS_TOKEN_TTL_SECONDS };
  });
}

export async function revokeSession(refreshToken: string): Promise<void> {
  await prisma.apiSession.updateMany({
    where: { refreshTokenHash: sha256(refreshToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllSessions(userId: string): Promise<number> {
  const result = await prisma.apiSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}
