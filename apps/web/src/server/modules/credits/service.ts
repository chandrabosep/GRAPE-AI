import { prisma, type CreditTransaction, type CreditTxType, type Prisma, transaction } from '@aam/db';
import { AppError } from '@aam/shared';
import { idempotencyKey as makeKey } from '../../lib/ids';

/**
 * The credit ledger.
 *
 * Credits are the only currency in the product, so this module is the single
 * place a balance can change. Three rules hold everything together:
 *
 *  1. The ledger is append-only. A balance is the tail of the ledger, never an
 *     independently mutated number. The database enforces this with a trigger,
 *     so even a bug here cannot rewrite history.
 *  2. Every write is idempotent. Reward grants and spend debits are retried by
 *     design (a dropped SSE connection, a repeated ack), and a retry must never
 *     double-credit or double-charge.
 *  3. Every write serialises on the user row. Two concurrent requests must not
 *     read the same starting balance and both succeed.
 */

export interface LedgerEntryInput {
  userId: string;
  type: CreditTxType;
  /** Signed: positive credits the user, negative debits. */
  amountMicro: bigint;
  refType?: string;
  refId?: string;
  /** Omit to derive one from the reference, which is what makes retries safe. */
  idempotencyKey?: string;
}

export interface LedgerResult {
  transaction: CreditTransaction;
  balanceMicro: bigint;
  /** True when this call matched an existing entry instead of creating one. */
  replayed: boolean;
}

function deriveKey(input: LedgerEntryInput): string {
  if (input.idempotencyKey) return input.idempotencyKey;
  if (input.refType && input.refId) {
    return makeKey(input.userId, input.type, input.refType, input.refId);
  }
  throw new Error(
    `Ledger entry for user ${input.userId} needs an idempotencyKey or a refType/refId pair`,
  );
}

/**
 * Appends one entry and returns the new balance.
 *
 * Runs inside a transaction that locks the user row first, so concurrent
 * requests queue rather than racing. Refuses any write that would take a
 * balance negative.
 */
export async function appendEntry(input: LedgerEntryInput): Promise<LedgerResult> {
  const key = deriveKey(input);

  return transaction(async (tx) => {
    const existing = await tx.creditTransaction.findUnique({ where: { idempotencyKey: key } });
    if (existing) {
      return {
        transaction: existing,
        balanceMicro: existing.balanceAfterMicro,
        replayed: true,
      };
    }

    // Serialise on the user row. Without this, two requests can read the same
    // starting balance and both write a valid-looking but wrong tail.
    const locked = await tx.$queryRaw<{ credit_balance_micro: bigint }[]>`
      SELECT credit_balance_micro FROM users WHERE id = ${input.userId} FOR UPDATE
    `;
    if (locked.length === 0) {
      throw new AppError('not_found', 'User not found');
    }

    const current = locked[0]!.credit_balance_micro;
    const next = current + input.amountMicro;

    if (next < 0n) {
      throw new AppError(
        'insufficient_credits',
        'Not enough credits for this request. Top up or earn credits from sponsored content.',
        { balanceMicro: current.toString(), requiredMicro: (-input.amountMicro).toString() },
      );
    }

    const transaction = await tx.creditTransaction.create({
      data: {
        userId: input.userId,
        type: input.type,
        amountMicro: input.amountMicro,
        balanceAfterMicro: next,
        refType: input.refType ?? null,
        refId: input.refId ?? null,
        idempotencyKey: key,
      },
    });

    await tx.user.update({
      where: { id: input.userId },
      data: { creditBalanceMicro: next },
    });

    return { transaction, balanceMicro: next, replayed: false };
  });
}

export async function getBalance(userId: string): Promise<bigint> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { creditBalanceMicro: true },
  });
  if (!user) throw new AppError('not_found', 'User not found');
  return user.creditBalanceMicro;
}

/** Positive credit types, summed. Used to cap withdrawals at what was actually earned. */
export async function lifetimeEarnedMicro(userId: string): Promise<bigint> {
  const result = await prisma.creditTransaction.aggregate({
    where: { userId, type: 'reward_earned' },
    _sum: { amountMicro: true },
  });
  return result._sum.amountMicro ?? 0n;
}

export async function lifetimeWithdrawnMicro(userId: string): Promise<bigint> {
  const result = await prisma.creditTransaction.aggregate({
    where: { userId, type: 'payout_debit' },
    _sum: { amountMicro: true },
  });
  // Debits are stored negative; report the magnitude.
  return -(result._sum.amountMicro ?? 0n);
}

/**
 * Purchased credits and earned credits are interchangeable for spending, but
 * only earnings may leave the system as money. Withdrawing purchased credits
 * would make this a money transmitter rather than a usage balance.
 */
export async function withdrawableMicro(userId: string): Promise<bigint> {
  const [earned, withdrawn, balance] = await Promise.all([
    lifetimeEarnedMicro(userId),
    lifetimeWithdrawnMicro(userId),
    getBalance(userId),
  ]);
  const earnedRemaining = earned - withdrawn;
  const cap = earnedRemaining < 0n ? 0n : earnedRemaining;
  return balance < cap ? balance : cap;
}

export async function listTransactions(
  userId: string,
  options: { limit?: number; cursor?: string } = {},
): Promise<CreditTransaction[]> {
  const limit = Math.min(options.limit ?? 50, 200);
  return prisma.creditTransaction.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
  });
}

// ---------------------------------------------------------------- operations

/** One-time grant so a new user can reach their first ad reward without paying. */
export function grantStarterCredits(userId: string, amountMicro: bigint): Promise<LedgerResult> {
  return appendEntry({
    userId,
    type: 'promo',
    amountMicro,
    refType: 'signup',
    refId: userId,
  });
}

export function creditReward(
  userId: string,
  amountMicro: bigint,
  rewardId: string,
): Promise<LedgerResult> {
  return appendEntry({
    userId,
    type: 'reward_earned',
    amountMicro,
    refType: 'reward',
    refId: rewardId,
  });
}

export function debitInference(
  userId: string,
  costMicro: bigint,
  requestId: string,
): Promise<LedgerResult> {
  return appendEntry({
    userId,
    type: 'inference_spent',
    amountMicro: -costMicro,
    refType: 'ai_request',
    refId: requestId,
  });
}

export function creditPurchase(
  userId: string,
  amountMicro: bigint,
  paymentId: string,
): Promise<LedgerResult> {
  return appendEntry({
    userId,
    type: 'purchase',
    amountMicro,
    refType: 'payment',
    refId: paymentId,
  });
}

export async function debitPayout(
  userId: string,
  amountMicro: bigint,
  payoutId: string,
): Promise<LedgerResult> {
  const available = await withdrawableMicro(userId);
  if (amountMicro > available) {
    throw new AppError(
      'forbidden',
      'Withdrawals are limited to credits earned from sponsored content',
      { withdrawableMicro: available.toString() },
    );
  }
  return appendEntry({
    userId,
    type: 'payout_debit',
    amountMicro: -amountMicro,
    refType: 'payout',
    refId: payoutId,
  });
}

export type { Prisma };
