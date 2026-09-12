import { prisma } from '@aam/db';
import { AppError } from '@aam/shared';
import { env } from '../../config/index';
import { logger } from '../../lib/logger';
import { creditPurchase } from '../credits/service';

/**
 * Buying credits by sending USDC on chain.
 *
 * Nothing here trusts the client. A transfer is only credited once the mirror
 * node says it happened, landed in the treasury, and carried the right token —
 * and the `txId` unique constraint on `payments` is what stops the same
 * transfer being credited twice. The replay guard is a database constraint, not
 * a code path that has to remember to check.
 *
 * Two ways in, both ending at `creditTransaction`:
 *
 *  - `redeemTopup` takes the hash of a transfer the browser just sent from the
 *    user's own wallet, which is the normal path and needs no copy-paste.
 *  - `claimTransfers` sweeps the user's *verified* wallets for transfers to the
 *    treasury nobody has claimed yet. That is what makes a top-up survive a
 *    closed tab, a wallet that returns no hash, or a send made from a phone.
 */

const MIRROR_NODE = 'https://testnet.mirrornode.hedera.com';

/** A just-submitted transfer is not on the mirror node yet; it arrives within seconds. */
const INDEXING_ATTEMPTS = 8;
const INDEXING_DELAY_MS = 1_500;

/** How far back a sweep looks. Old enough for a tab left closed overnight. */
const SWEEP_WINDOW_DAYS = 7;
const SWEEP_LIMIT = 50;
/** Cap on full record lookups per wallet, so one sweep is a bounded amount of work. */
const SWEEP_LOOKUPS = 10;

interface MirrorTokenTransfer {
  token_id: string;
  account: string;
  amount: number;
}

interface MirrorTransaction {
  result: string;
  name: string;
  transaction_id?: string;
  consensus_timestamp: string;
  token_transfers?: MirrorTokenTransfer[];
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function mirror<T>(path: string): Promise<T | null> {
  const response = await fetch(`${MIRROR_NODE}${path}`, { headers: { accept: 'application/json' } });
  if (!response.ok) return null;
  return (await response.json()) as T;
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
 * A wallet like MetaMask hands us a `0x…` hash, while HashPack hands back
 * `0.0.x@s.n`; both describe the same transfer and nobody should have to know
 * which one we wanted. The mirror node has no direct hash→id lookup, so this
 * goes via the contract result's consensus timestamp.
 *
 * It retries, because the browser posts the hash the instant the wallet returns
 * it — a second or two before the mirror node has indexed anything. Failing
 * there would push the wait back onto the user, which is the whole problem this
 * flow exists to remove.
 */
async function resolveEvmHash(hash: string): Promise<string> {
  for (let attempt = 0; attempt < INDEXING_ATTEMPTS; attempt += 1) {
    if (attempt > 0) await sleep(INDEXING_DELAY_MS);

    const result = await mirror<{ timestamp?: string }>(
      `/api/v1/contracts/results/${hash.trim()}`,
    );
    if (!result?.timestamp) continue;

    const listing = await mirror<{ transactions?: { transaction_id?: string }[] }>(
      `/api/v1/transactions?timestamp=${result.timestamp}`,
    );
    const id = listing?.transactions?.[0]?.transaction_id;
    if (id) return normalizeTxId(id);
  }

  throw new AppError(
    'validation_failed',
    'That transaction has not appeared on Hedera yet. Give it a moment and try again.',
  );
}

/** The Hedera account id that receives top-ups. */
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

/**
 * The "long-zero" EVM address of a Hedera account: its number in the low bytes.
 *
 * Every account has one, and the HTS system contract resolves it, so it is a
 * safe answer when the mirror node cannot be reached.
 */
function longZeroAddress(accountId: string): string {
  const num = accountId.split('.')[2] ?? '0';
  return `0x${BigInt(num).toString(16).padStart(40, '0')}`;
}

let cachedTreasuryAddress: string | null = null;

/**
 * The EVM address a wallet sends to.
 *
 * The treasury is configured once, as a Hedera id, because that is the form the
 * mirror node verifies against — but the browser pays by calling `transfer` on
 * the token contract and needs an address. An account created from an ECDSA key
 * has an alias-derived address that is *not* its long-zero form, so this asks
 * the mirror node rather than deriving one and hoping. Cached because it is a
 * deployment constant, not a per-request fact.
 */
export async function treasuryEvmAddress(): Promise<string> {
  const accountId = treasuryAccountId();
  if (cachedTreasuryAddress) return cachedTreasuryAddress;

  const account = await mirror<{ evm_address?: string }>(`/api/v1/accounts/${accountId}`);
  cachedTreasuryAddress = account?.evm_address ?? longZeroAddress(accountId);
  return cachedTreasuryAddress;
}

/**
 * Every record filed under one transaction id, parent and children alike.
 *
 * `attempts` is 1 for a transfer that is already in the past and more when the
 * browser has just submitted one, where the wait is the mirror node catching up.
 */
async function fetchRecords(txId: string, attempts = INDEXING_ATTEMPTS): Promise<MirrorTransaction[]> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) await sleep(INDEXING_DELAY_MS);
    const body = await mirror<{ transactions?: MirrorTransaction[] }>(
      `/api/v1/transactions/${txId}`,
    );
    if (body?.transactions?.length) return body.transactions;
  }
  return [];
}

/**
 * How much USDC these records left the treasury holding.
 *
 * A transfer made through the ERC-20 facade lands in a child record rather than
 * the parent — an EVM payment arrives as an ETHEREUMTRANSACTION with the actual
 * transfer one level down — so every record under the id is scanned instead of
 * just the first.
 *
 * The sum is signed rather than a filter on incoming legs: a transaction that
 * takes a hundred dollars out of the treasury and puts one back is worth
 * nothing to us, and counting only the dollar coming in would credit it.
 */
function creditedAmount(records: MirrorTransaction[]): bigint {
  const treasury = treasuryAccountId();
  const token = usdcTokenId();

  return records
    .flatMap((record) => record.token_transfers ?? [])
    .filter((t) => t.token_id === token && t.account === treasury)
    .reduce((sum, t) => sum + BigInt(t.amount), 0n);
}

export interface TopupResult {
  creditedMicro: bigint;
  txId: string;
  balanceMicro: bigint;
}

/**
 * Writes the payment and the ledger entry for a verified transfer.
 *
 * USDC and the ledger are both 6dp, so the token amount is the credit amount —
 * a dollar sent is a dollar of credits, with no conversion step to get wrong.
 */
async function recordTopup(
  userId: string,
  txId: string,
  credited: bigint,
  submitted: string,
): Promise<TopupResult> {
  const payment = await prisma.payment.create({
    data: {
      kind: 'credit_topup',
      network: 'hedera:testnet',
      txId,
      fromAddress: 'onchain',
      toAddress: treasuryAccountId(),
      asset: usdcTokenId(),
      amountRaw: credited.toString(),
      amountMicro: credited,
      status: 'confirmed',
      userId,
      confirmedAt: new Date(),
      raw: { submitted },
    },
  });

  const ledger = await creditPurchase(userId, credited, payment.id);

  return { creditedMicro: credited, txId, balanceMicro: ledger.balanceMicro };
}

export async function redeemTopup(userId: string, rawTxId: string): Promise<TopupResult> {
  const txId = isEvmHash(rawTxId) ? await resolveEvmHash(rawTxId) : normalizeTxId(rawTxId);

  // Cheap rejection before spending network calls on a transfer we already
  // credited. The unique constraint below is still the real guard.
  const existing = await prisma.payment.findUnique({ where: { txId } });
  if (existing) {
    throw new AppError('validation_failed', 'That transaction has already been credited');
  }

  const records = await fetchRecords(txId);
  if (records.length === 0) {
    throw new AppError('validation_failed', 'No such transaction on Hedera testnet');
  }
  if (!records.some((record) => record.result === 'SUCCESS')) {
    throw new AppError(
      'validation_failed',
      `That transaction did not succeed (${records[0]!.result})`,
    );
  }

  const credited = creditedAmount(records);
  if (credited <= 0n) {
    throw new AppError(
      'validation_failed',
      `That transaction did not send USDC (${usdcTokenId()}) to ${treasuryAccountId()}`,
    );
  }

  return recordTopup(userId, txId, credited, rawTxId.trim());
}

/** The Hedera account id behind an EVM address, or null if it has never been used. */
async function accountIdForAddress(address: string): Promise<string | null> {
  const account = await mirror<{ account?: string }>(`/api/v1/accounts/${address}`);
  return account?.account ?? null;
}

export interface ClaimResult {
  claimed: { txId: string; creditedMicro: bigint }[];
  creditedMicro: bigint;
  balanceMicro: bigint | null;
}

/**
 * Credits any unclaimed USDC this user has already sent to the treasury.
 *
 * Only wallets the user has *proved* they control are swept, and a transfer
 * only counts when the same records that credit the treasury also debit that
 * wallet. Without the second half, one person's deposit could be claimed by
 * anyone who happened to appear in the same transaction.
 *
 * This is what makes the flow forgiving: a send from a phone, a tab closed
 * before the hash came back, or a wallet that swallowed the receipt all still
 * end up credited without anyone pasting anything.
 */
export async function claimTransfers(userId: string): Promise<ClaimResult> {
  const treasury = treasuryAccountId();
  const token = usdcTokenId();

  const wallets = await prisma.wallet.findMany({
    where: { userId, verifiedAt: { not: null } },
    select: { address: true },
  });

  const since = Math.floor((Date.now() - SWEEP_WINDOW_DAYS * 86_400_000) / 1000);
  const claimed: { txId: string; creditedMicro: bigint }[] = [];
  let balanceMicro: bigint | null = null;

  for (const wallet of wallets) {
    const accountId = await accountIdForAddress(wallet.address);
    if (!accountId || accountId === treasury) continue;

    const listing = await mirror<{ transactions?: MirrorTransaction[] }>(
      `/api/v1/transactions?account.id=${accountId}&limit=${SWEEP_LIMIT}&order=desc&timestamp=gte:${since}`,
    );

    // Only the ids are taken from the listing. A transfer made through the
    // ERC-20 facade splits across a parent contract call and a child transfer,
    // and the listing does not reliably carry both under this account — so each
    // candidate is read back in full, where the child records are guaranteed.
    const candidates = [
      ...new Set(
        (listing?.transactions ?? [])
          .map((record) => record.transaction_id)
          .filter((id): id is string => Boolean(id))
          .map(normalizeTxId),
      ),
    ];
    if (candidates.length === 0) continue;

    const known = await prisma.payment.findMany({
      where: { txId: { in: candidates } },
      select: { txId: true },
    });
    const seen = new Set(known.map((payment) => payment.txId));

    for (const txId of candidates.filter((id) => !seen.has(id)).slice(0, SWEEP_LOOKUPS)) {
      const records = await fetchRecords(txId, 1);
      if (!records.some((record) => record.result === 'SUCCESS')) continue;

      // The same records must debit *this* wallet as well as credit the
      // treasury. Without that half, a deposit could be claimed by anyone who
      // merely appeared in the same transaction.
      const paidByWallet = records
        .flatMap((record) => record.token_transfers ?? [])
        .some((t) => t.token_id === token && t.account === accountId && t.amount < 0);
      if (!paidByWallet) continue;

      const credited = creditedAmount(records);
      if (credited <= 0n) continue;

      try {
        const result = await recordTopup(userId, txId, credited, `sweep:${wallet.address}`);
        balanceMicro = result.balanceMicro;
        claimed.push({ txId, creditedMicro: credited });
      } catch (error) {
        // A concurrent sweep or a redeem from the browser got there first; the
        // unique constraint did its job and there is nothing to report.
        logger.debug({ err: error, txId }, 'top-up sweep skipped an already-credited transfer');
      }
    }
  }

  return {
    claimed,
    creditedMicro: claimed.reduce((sum, entry) => sum + entry.creditedMicro, 0n),
    balanceMicro,
  };
}
