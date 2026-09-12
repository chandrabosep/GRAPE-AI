import { prisma } from '@aam/db';
import { AppError } from '@aam/shared';
import { env } from '../../config/index';
import { creditPurchase } from '../credits/service';

/**
 * Buying credits by sending USDC on chain.
 *
 * There is no wallet integration here on purpose: the user sends from whatever
 * wallet they already have, then hands us the transaction id. We verify it
 * against the mirror node rather than trusting the claim, and the `txId` unique
 * constraint on `payments` is what stops the same transfer being credited
 * twice — the replay guard is a database constraint, not a code path that has
 * to remember to check.
 */

const MIRROR_NODE = 'https://testnet.mirrornode.hedera.com';

interface MirrorTokenTransfer {
  token_id: string;
  account: string;
  amount: number;
}

interface MirrorTransaction {
  result: string;
  name: string;
  consensus_timestamp: string;
  token_transfers?: MirrorTokenTransfer[];
}

/** `0.0.7@1.2` and `0.0.7-1-2` are the same transaction; the API wants the latter. */
function normalizeTxId(raw: string): string {
  const at = raw.trim().replace('@', '-');
  const parts = at.split('-');
  if (parts.length === 2 && parts[1]?.includes('.')) {
    return `${parts[0]}-${parts[1].replace('.', '-')}`;
  }
  return at;
}

function isEvmHash(raw: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(raw.trim());
}

/**
 * Turns an EVM transaction hash into the Hedera transaction id.
 *
 * A wallet like MetaMask hands the user a `0x…` hash, while HashPack hands
 * them `0.0.x@s.n`; both describe the same transfer and a user should not have
 * to know which one we wanted. The mirror node has no direct hash→id lookup,
 * so this goes via the contract result's consensus timestamp.
 */
async function resolveEvmHash(hash: string): Promise<string> {
  const result = await fetch(`${MIRROR_NODE}/api/v1/contracts/results/${hash.trim()}`, {
    headers: { accept: 'application/json' },
  });
  if (!result.ok) {
    throw new AppError('validation_failed', 'No such transaction on Hedera testnet');
  }

  const { timestamp } = (await result.json()) as { timestamp?: string };
  if (!timestamp) {
    throw new AppError('validation_failed', 'That transaction has not been indexed yet');
  }

  const listing = await fetch(`${MIRROR_NODE}/api/v1/transactions?timestamp=${timestamp}`, {
    headers: { accept: 'application/json' },
  });
  const body = (await listing.json()) as { transactions?: { transaction_id?: string }[] };
  const id = body.transactions?.[0]?.transaction_id;
  if (!id) {
    throw new AppError('validation_failed', 'That transaction has not been indexed yet');
  }
  return normalizeTxId(id);
}

/** The Hedera account id that receives top-ups, derived from the treasury EVM address. */
function treasuryAccountId(): string {
  const id = env().TREASURY_ACCOUNT_ID;
  if (!id) {
    throw new AppError('upstream_unavailable', 'Top-ups are not configured on this deployment');
  }
  return id;
}

function usdcTokenId(): string {
  const id = env().USDC_TOKEN_ID;
  if (!id) {
    throw new AppError('upstream_unavailable', 'Top-ups are not configured on this deployment');
  }
  return id;
}

export interface TopupResult {
  creditedMicro: bigint;
  txId: string;
  balanceMicro: bigint;
}

export async function redeemTopup(userId: string, rawTxId: string): Promise<TopupResult> {
  const txId = isEvmHash(rawTxId) ? await resolveEvmHash(rawTxId) : normalizeTxId(rawTxId);

  // Cheap rejection before spending a network call on a transfer we already
  // credited. The unique constraint below is still the real guard.
  const existing = await prisma.payment.findUnique({ where: { txId } });
  if (existing) {
    throw new AppError('validation_failed', 'That transaction has already been credited');
  }

  const response = await fetch(`${MIRROR_NODE}/api/v1/transactions/${txId}`, {
    headers: { accept: 'application/json' },
  });
  if (!response.ok) {
    throw new AppError('validation_failed', 'No such transaction on Hedera testnet');
  }

  const body = (await response.json()) as { transactions?: MirrorTransaction[] };
  const records = body.transactions ?? [];
  if (records.length === 0) {
    throw new AppError('validation_failed', 'No such transaction on Hedera testnet');
  }
  if (!records.some((r) => r.result === 'SUCCESS')) {
    throw new AppError('validation_failed', `That transaction did not succeed (${records[0]!.result})`);
  }

  const treasury = treasuryAccountId();
  const token = usdcTokenId();

  // A transfer made through the ERC-20 facade lands in a child record, not the
  // parent, so every record under this id is scanned rather than just the first.
  const credited = records
    .flatMap((r) => r.token_transfers ?? [])
    .filter((t) => t.token_id === token && t.account === treasury && t.amount > 0)
    .reduce((sum, t) => sum + BigInt(t.amount), 0n);

  if (credited <= 0n) {
    throw new AppError(
      'validation_failed',
      `That transaction did not send USDC (${token}) to ${treasury}`,
    );
  }

  // USDC and the ledger are both 6dp, so the token amount is the credit amount.
  const payment = await prisma.payment.create({
    data: {
      kind: 'credit_topup',
      network: 'hedera:testnet',
      txId,
      fromAddress: 'onchain',
      toAddress: treasury,
      asset: token,
      amountRaw: credited.toString(),
      amountMicro: credited,
      status: 'confirmed',
      userId,
      confirmedAt: new Date(),
      raw: { submitted: rawTxId.trim() },
    },
  });

  const ledger = await creditPurchase(userId, credited, payment.id);

  return { creditedMicro: credited, txId, balanceMicro: ledger.balanceMicro };
}
