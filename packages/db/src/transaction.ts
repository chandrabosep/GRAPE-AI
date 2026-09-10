import { prisma } from './client';
import type { Prisma } from '../generated/prisma/client';

/**
 * Interactive transactions with timeouts that survive a distant database.
 *
 * Prisma waits 2s by default to acquire a connection before giving up with
 * P2028 ("Unable to start a transaction in the given time"). That is generous on
 * localhost and far too tight against a managed database in another region: a
 * warm round trip to a remote Supabase instance is ~400ms, and a cold one can
 * exceed 2.5s on its own, so the very first transaction after an idle period
 * fails while every plain query succeeds. It looks like a bug in the code rather
 * than a budget, which is exactly what makes it worth centralising.
 *
 * Use this instead of prisma.$transaction so the budget is set in one place.
 */

export const TRANSACTION_OPTIONS = {
  /** How long to wait for a connection before giving up. */
  maxWait: 15_000,
  /** How long the transaction itself may run once started. */
  timeout: 30_000,
} as const;

export function transaction<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  options?: { maxWait?: number; timeout?: number },
): Promise<T> {
  return prisma.$transaction(fn, { ...TRANSACTION_OPTIONS, ...options });
}
