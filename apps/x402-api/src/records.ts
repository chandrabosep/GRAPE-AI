import type { TokenUsage } from '@aam/ai-provider';

export interface PaymentRecord {
  network: string;
  txId: string;
  payer: string;
  payTo: string;
  asset: string;
  amountRaw: string;
  facilitator: string;
  requestId: string;
  tier: string;
}

export interface UsageRecord {
  requestId: string;
  provider: string;
  model: string;
  usage: TokenUsage;
  latencyMs: number;
  stopReason: string | null;
}

/**
 * Persistence is best-effort, on purpose.
 *
 * The payment has already settled on Hedera by the time this runs, so a
 * database that is down must not turn a completed purchase into a 500 the
 * agent will retry — that would charge twice for one answer. The ledger of
 * record is the chain; these rows are the local index of it, and a failure to
 * write one is logged and swallowed.
 */
export async function record(payment: PaymentRecord, usage: UsageRecord): Promise<void> {
  try {
    const { prisma } = await import('@aam/db');

    await prisma.$transaction([
      prisma.payment.create({
        data: {
          kind: 'x402_inference',
          network: payment.network,
          txId: payment.txId,
          fromAddress: payment.payer,
          toAddress: payment.payTo,
          asset: payment.asset,
          amountRaw: payment.amountRaw,
          status: 'confirmed',
          requestId: payment.requestId,
          facilitator: payment.facilitator,
          confirmedAt: new Date(),
          raw: { tier: payment.tier },
        },
      }),
      prisma.aiUsage.create({
        data: {
          requestId: usage.requestId,
          provider: usage.provider,
          model: usage.model,
          inputTokens: usage.usage.inputTokens,
          outputTokens: usage.usage.outputTokens,
          totalTokens: usage.usage.totalTokens,
          // An x402 call is paid for in HBAR on Hedera, not in credits, so the
          // credit ledger is deliberately untouched: cost and charge are both
          // zero micro-USD here and the money side lives in `payments`.
          costMicro: 0n,
          chargedMicro: 0n,
          fundingSource: 'x402',
          latencyMs: usage.latencyMs,
          stopReason: usage.stopReason,
        },
      }),
    ]);
  } catch (error) {
    console.warn('[x402] could not persist payment/usage rows:', (error as Error).message);
  }
}
