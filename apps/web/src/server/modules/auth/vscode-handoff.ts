import { prisma } from '@aam/db';
import { AppError } from '@aam/shared';
import { newOpaqueToken, sha256 } from '../../lib/ids';
import { issueSession, type IssuedSession } from './session';

/**
 * Browser-to-editor login handoff.
 *
 * The extension opens the web app with a random `state`, the signed-in browser
 * asks us for a one-time code, and the extension exchanges that code for its own
 * session. Two properties matter: the code is single-use and short-lived, and
 * the `state` must match, which is what stops another page from completing a
 * login the user did not start. Nothing sensitive travels in the callback URL —
 * a Privy token in a query string would end up in shell history and logs.
 */

const CODE_TTL_MS = 5 * 60 * 1000;

export async function createHandoffCode(userId: string, state: string): Promise<string> {
  const code = newOpaqueToken(24);

  await prisma.vsCodeAuthCode.create({
    data: {
      codeHash: sha256(code),
      userId,
      state,
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    },
  });

  return code;
}

/**
 * Redeems a handoff code exactly once.
 *
 * The update-then-check pattern is deliberate: marking the code used inside the
 * same transaction that reads it means two simultaneous redemptions cannot both
 * succeed.
 */
export async function redeemHandoffCode(
  code: string,
  state: string,
  userAgent?: string,
): Promise<IssuedSession> {
  const codeHash = sha256(code);

  const userId = await prisma.$transaction(async (tx) => {
    const record = await tx.vsCodeAuthCode.findUnique({ where: { codeHash } });

    if (!record || record.usedAt || record.expiresAt < new Date()) {
      throw new AppError('unauthorized', 'This sign-in link has expired. Try signing in again.');
    }
    if (record.state !== state) {
      throw new AppError('unauthorized', 'Sign-in request did not match. Try signing in again.');
    }

    await tx.vsCodeAuthCode.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    });

    return record.userId;
  });

  return issueSession(userId, 'vscode', userAgent);
}

/** Housekeeping so expired codes do not accumulate. Safe to call often. */
export async function purgeExpiredCodes(): Promise<number> {
  const result = await prisma.vsCodeAuthCode.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return result.count;
}
