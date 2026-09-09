import { prisma, type Prisma, type User } from '@aam/db';
import { AppError } from '@aam/shared';
import { economics } from '../../config/index.js';
import { logger } from '../../lib/logger.js';
import { grantStarterCredits } from '../credits/service.js';
import type { PrivyIdentity } from '../auth/privy.js';

/**
 * Users are keyed by Privy DID, never by email or wallet address.
 *
 * A DID is stable across a user linking or unlinking accounts, and it keeps the
 * identity we store free of anything an advertiser could correlate against.
 */

export type UserWithProfile = Prisma.UserGetPayload<{ include: { profile: true } }>;

/**
 * Finds or creates the user behind a verified Privy identity.
 *
 * First sign-in also issues the starter credit grant, which exists to break the
 * cold-start loop: ads only appear while using AI, using AI costs credits, and
 * earning credits requires seeing ads. Without an opening balance a new user
 * could do nothing at all.
 */
export async function upsertFromPrivy(identity: PrivyIdentity): Promise<UserWithProfile> {
  const existing = await prisma.user.findUnique({
    where: { privyDid: identity.did },
    include: { profile: true },
  });

  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        lastSeenAt: new Date(),
        ...(identity.email && identity.email !== existing.email ? { email: identity.email } : {}),
      },
    });
    return existing;
  }

  const created = await prisma.user.create({
    data: {
      privyDid: identity.did,
      email: identity.email,
      lastSeenAt: new Date(),
      profile: { create: {} },
    },
    include: { profile: true },
  });

  const starter = BigInt(economics().credits.starterGrantMicro);
  if (starter > 0n) {
    try {
      await grantStarterCredits(created.id, starter);
    } catch (error) {
      // A failed grant must not block sign-in; it is recoverable and idempotent.
      logger.error({ err: error, userId: created.id }, 'starter credit grant failed');
    }
  }

  logger.info({ userId: created.id }, 'created user');
  return created;
}

export async function getUser(userId: string): Promise<UserWithProfile> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { profile: true },
  });
  if (!user) throw new AppError('not_found', 'User not found');
  return user;
}

export interface ProfileUpdate {
  displayName?: string;
  countryCode?: string | null;
  persona?: string | null;
  interests?: string[];
  technologies?: string[];
  adsOptOut?: boolean;
  includeCodeContext?: boolean;
}

export async function updateProfile(userId: string, update: ProfileUpdate): Promise<UserWithProfile> {
  const { displayName, countryCode, ...profileFields } = update;

  return prisma.user.update({
    where: { id: userId },
    data: {
      ...(displayName !== undefined ? { displayName } : {}),
      ...(countryCode !== undefined ? { countryCode } : {}),
      profile: {
        upsert: {
          create: profileFields,
          update: profileFields,
        },
      },
    },
    include: { profile: true },
  });
}

export function hasRole(user: Pick<User, 'roles'>, role: string): boolean {
  return user.roles.includes(role);
}

export async function grantRole(userId: string, role: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { roles: true } });
  if (!user) throw new AppError('not_found', 'User not found');
  if (user.roles.includes(role)) return;

  await prisma.user.update({
    where: { id: userId },
    data: { roles: { set: [...user.roles, role] } },
  });
}
