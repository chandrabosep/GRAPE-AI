import { prisma, type Prisma, type User } from '@aam/db';
import { AppError } from '@aam/shared';
import { economics } from '../../config/index';
import { logger } from '../../lib/logger';
import { grantStarterCredits } from '../credits/service';


/**
 * Users are keyed by a provider-prefixed subject, never by email.
 *
 * The prefix ("wallet:", "seed:") means two auth providers can never collide on
 * the same value, and it keeps the stored identity free of anything an
 * advertiser could correlate against.
 */
export interface ExternalIdentity {
  subject: string;
  email?: string | null;
  displayName?: string | null;
}

export type UserWithProfile = Prisma.UserGetPayload<{ include: { profile: true } }>;

/**
 * Finds or creates the user behind a verified Privy identity.
 *
 * First sign-in also issues the starter credit grant, which exists to break the
 * cold-start loop: ads only appear while using AI, using AI costs credits, and
 * earning credits requires seeing ads. Without an opening balance a new user
 * could do nothing at all.
 */
export async function upsertFromIdentity(identity: ExternalIdentity): Promise<UserWithProfile> {
  const existing = await prisma.user.findUnique({
    where: { subject: identity.subject },
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
      subject: identity.subject,
      email: identity.email ?? null,
      displayName: identity.displayName ?? null,
      lastSeenAt: new Date(),
      profile: { create: {} },
    },
    include: { profile: true },
  });

  const starter = BigInt(economics().credits.starterGrantMicro);
  if (starter > 0n) {
    try {
      const granted = await grantStarterCredits(created.id, starter);
      // The row was read before the grant, so its balance would otherwise be
      // stale and every caller reading it back would see zero.
      created.creditBalanceMicro = granted.balanceMicro;
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
