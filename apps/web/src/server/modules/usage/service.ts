import { prisma, type AiUsage, type ClientKind, type FundingSource } from '@aam/db';
import { AppError } from '@aam/shared';
import type { TokenUsage } from '@aam/ai-provider';
import { affordableOutputTokens, checkAffordable, costMicro, getModelPricing } from '@aam/economics';
import { economics } from '../../config/index';
import { logger } from '../../lib/logger';
import { debitInference, getBalance } from '../credits/service';

/**
 * Token accounting and spend enforcement.
 *
 * The client is never trusted here. Limits are checked before the model is
 * called and the charge is computed from the provider's own reported token
 * counts afterwards, so neither the extension nor a crafted request can
 * influence what a user is billed or how much they may consume.
 */

export interface SpendAuthorization {
  balanceMicro: bigint;
  /** Clamped so a request cannot start and then run out of credits mid-answer. */
  maxOutputTokens: number;
}

/**
 * Decides whether a request may proceed, before any tokens are spent.
 *
 * Rather than reserving a worst-case amount and refunding the difference, this
 * clamps the output length to what the balance can actually pay for. The user
 * gets a shorter answer instead of a refusal, and the ledger only ever records
 * real spend.
 */
export async function authorizeSpend(
  userId: string,
  model: string,
  promptChars: number,
  requestedMaxTokens: number,
): Promise<SpendAuthorization> {
  const pricing = getModelPricing(economics(), model);
  if (!pricing) {
    throw new AppError('validation_failed', `No pricing configured for model ${model}`);
  }

  const balanceMicro = await getBalance(userId);

  // Charge for the prompt regardless of how long the answer turns out to be.
  const promptOnly = costMicro(pricing, Math.ceil(promptChars / 4), 0);
  if (!checkAffordable(promptOnly, balanceMicro).affordable) {
    throw new AppError(
      'insufficient_credits',
      'Not enough credits for this request. Buy credits, or earn them from sponsored content.',
      { balanceMicro: balanceMicro.toString() },
    );
  }

  const cap = economics().credits.maxRequestCostMicro;
  const budgetMicro = balanceMicro < BigInt(cap) ? balanceMicro : BigInt(cap);

  const maxOutputTokens = affordableOutputTokens(
    pricing,
    promptChars,
    budgetMicro,
    requestedMaxTokens,
  );

  if (maxOutputTokens === 0) {
    throw new AppError(
      'insufficient_credits',
      'Not enough credits to produce a useful answer. Buy credits, or earn them from sponsored content.',
      { balanceMicro: balanceMicro.toString() },
    );
  }

  return { balanceMicro, maxOutputTokens };
}

export interface RecordUsageInput {
  userId: string | null;
  sessionId: string | null;
  requestId: string;
  provider: string;
  model: string;
  usage: TokenUsage;
  fundingSource: FundingSource;
  latencyMs: number;
  stopReason: string | null;
}

export interface RecordUsageResult {
  usage: AiUsage;
  chargedMicro: bigint;
  balanceMicro: bigint | null;
}

/**
 * Records what a request actually consumed and charges for it.
 *
 * Called with the provider's final usage report, which is the only token count
 * allowed to reach the ledger. Idempotent on requestId, because a retried or
 * duplicated finaliser must not bill twice.
 */
export async function recordUsage(input: RecordUsageInput): Promise<RecordUsageResult> {
  const pricing = getModelPricing(economics(), input.model);
  const charged = pricing
    ? costMicro(pricing, input.usage.inputTokens, input.usage.outputTokens)
    : 0n;

  const existing = await prisma.aiUsage.findUnique({ where: { requestId: input.requestId } });
  if (existing) {
    return {
      usage: existing,
      chargedMicro: existing.chargedMicro,
      balanceMicro: input.userId ? await getBalance(input.userId) : null,
    };
  }

  const usage = await prisma.aiUsage.create({
    data: {
      userId: input.userId,
      sessionId: input.sessionId,
      requestId: input.requestId,
      provider: input.provider,
      model: input.model,
      inputTokens: input.usage.inputTokens,
      outputTokens: input.usage.outputTokens,
      totalTokens: input.usage.totalTokens,
      costMicro: charged,
      chargedMicro: input.fundingSource === 'x402' ? 0n : charged,
      fundingSource: input.fundingSource,
      latencyMs: input.latencyMs,
      stopReason: input.stopReason,
    },
  });

  // Agent traffic paid at the door via x402, so there is no balance to debit.
  if (!input.userId || input.fundingSource === 'x402' || charged === 0n) {
    return { usage, chargedMicro: 0n, balanceMicro: null };
  }

  try {
    const result = await debitInference(input.userId, charged, input.requestId);
    return { usage, chargedMicro: charged, balanceMicro: result.balanceMicro };
  } catch (error) {
    // The tokens were already spent upstream, so the usage row stands and the
    // balance is allowed to reach zero rather than the charge being silently
    // dropped. authorizeSpend is what prevents this from being reachable.
    logger.error(
      { err: error, userId: input.userId, requestId: input.requestId },
      'failed to debit credits for completed request',
    );
    return { usage, chargedMicro: charged, balanceMicro: null };
  }
}

export async function startSession(
  userId: string | null,
  client: ClientKind,
  model: string,
): Promise<string> {
  const session = await prisma.aiSession.create({
    data: { userId, client, model },
    select: { id: true },
  });
  return session.id;
}

/** Client ids are uuids; anything else is not one of ours and is not trusted. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Turns a conversation id from a client into a real session row.
 *
 * Conversations live on the client — the schema has no table that could hold a
 * prompt or a reply — so the id a client sends is a grouping key it made up,
 * not something the server issued. It still has to resolve to an `AiSession`
 * before it can be written to `AiUsage.session_id`, or the usage insert trips a
 * foreign key after the answer has already been delivered and the advertiser
 * already charged.
 *
 * Adopting the client's id as the primary key keeps one id across the whole
 * conversation, and the ownership check is what makes that safe: a session id
 * that belongs to somebody else is treated as though it had never been sent,
 * so guessing one buys an attacker nothing but their own new session.
 */
export async function resolveSession(
  userId: string,
  clientSessionId: string | null,
  client: ClientKind,
  model: string,
): Promise<string | null> {
  if (!clientSessionId || !UUID.test(clientSessionId)) {
    return startSession(userId, client, model).catch(() => null);
  }

  const existing = await prisma.aiSession.findUnique({
    where: { id: clientSessionId },
    select: { id: true, userId: true },
  });

  if (existing) {
    return existing.userId === userId
      ? existing.id
      : await startSession(userId, client, model).catch(() => null);
  }

  try {
    const created = await prisma.aiSession.create({
      data: { id: clientSessionId, userId, client, model },
      select: { id: true },
    });
    return created.id;
  } catch {
    // Lost a race with a concurrent request for the same conversation, or the
    // insert failed for a reason that is not worth failing an answer over.
    const raced = await prisma.aiSession
      .findUnique({ where: { id: clientSessionId }, select: { id: true, userId: true } })
      .catch(() => null);
    return raced?.userId === userId ? raced.id : null;
  }
}

export async function touchSession(sessionId: string): Promise<void> {
  await prisma.aiSession
    .update({ where: { id: sessionId }, data: { lastActivityAt: new Date() } })
    .catch(() => undefined);
}

export interface UsageSummary {
  todayTokens: number;
  todayCostMicro: bigint;
  requestCount: number;
}

export async function usageSummary(userId: string, since: Date): Promise<UsageSummary> {
  const result = await prisma.aiUsage.aggregate({
    where: { userId, createdAt: { gte: since } },
    _sum: { totalTokens: true, chargedMicro: true },
    _count: { _all: true },
  });

  return {
    todayTokens: result._sum.totalTokens ?? 0,
    todayCostMicro: result._sum.chargedMicro ?? 0n,
    requestCount: result._count._all,
  };
}
