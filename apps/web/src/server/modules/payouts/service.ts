import { prisma } from '@aam/db';
import {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  keccak256,
  parseAbi,
  toHex,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { hederaTestnet } from 'viem/chains';
import { env } from '../../config/index';
import { AppError } from '@aam/shared';
import { debitPayout, withdrawableMicro } from '../credits/service';

/**
 * Paying earned credits out as real USDC on Hedera.
 *
 * The ledger and the chain are two different books, and the whole risk here is
 * them disagreeing. The order below is deliberate: the ledger is debited first,
 * so a crash can only ever leave a user owed money rather than paid twice, and
 * the payout id is carried onto the chain so the retry that fixes it is safe —
 * `RewardPool.payout` rejects an id it has already paid.
 */

const POOL_ABI = parseAbi([
  'function payout(bytes32 payoutId, address to, uint256 amount) external',
  'function paid(bytes32) view returns (bool)',
]);

/** USDC and the credit ledger are both 6dp, so a credit micro is a token unit. */
function toTokenUnits(amountMicro: bigint): bigint {
  return amountMicro;
}

function poolAddress(): Hex {
  const address = env().REWARD_POOL_ADDRESS;
  if (!address) {
    throw new AppError('upstream_unavailable', 'Withdrawals are not configured on this deployment');
  }
  return getAddress(address);
}

function operator() {
  const key = env().OPERATOR_PRIVATE_KEY;
  if (!key) {
    throw new AppError('upstream_unavailable', 'Withdrawals are not configured on this deployment');
  }
  return privateKeyToAccount((key.startsWith('0x') ? key : `0x${key}`) as Hex);
}

function clients() {
  const transport = http(env().RPC_URL);
  return {
    publicClient: createPublicClient({ chain: hederaTestnet, transport }),
    walletClient: createWalletClient({ account: operator(), chain: hederaTestnet, transport }),
  };
}

/** bytes32 the contract can key on, derived from the ledger's own payout id. */
function onchainPayoutId(payoutId: string): Hex {
  return keccak256(toHex(payoutId));
}

export interface WithdrawInput {
  userId: string;
  amountMicro: bigint;
  /** EVM address, which on Hedera is also how an account id is addressed. */
  to: string;
}

export interface WithdrawResult {
  payoutId: string;
  txHash: string;
  amountMicro: bigint;
  to: string;
  explorerUrl: string;
}

export async function withdraw(input: WithdrawInput): Promise<WithdrawResult> {
  if (input.amountMicro <= 0n) {
    throw new AppError('validation_failed', 'Withdrawal amount must be positive');
  }

  let to: Hex;
  try {
    to = getAddress(input.to);
  } catch {
    throw new AppError('validation_failed', 'Not a valid EVM address');
  }

  // Checked before the debit purely so the caller gets a useful message; the
  // debit re-checks inside its transaction, which is what actually guards it.
  const available = await withdrawableMicro(input.userId);
  if (input.amountMicro > available) {
    throw new AppError('forbidden', 'Amount exceeds withdrawable balance', {
      withdrawableMicro: available.toString(),
    });
  }

  const payoutId = crypto.randomUUID();

  // Ledger first. `debitPayout` rejects anything beyond credits that were
  // *earned*, so purchased credits can never leave as money.
  await debitPayout(input.userId, input.amountMicro, payoutId);

  const { publicClient, walletClient } = clients();
  const pool = poolAddress();
  const onchainId = onchainPayoutId(payoutId);

  let txHash: Hex;
  try {
    txHash = await walletClient.writeContract({
      address: pool,
      abi: POOL_ABI,
      functionName: 'payout',
      args: [onchainId, to, toTokenUnits(input.amountMicro)],
    });
  } catch (cause) {
    // The debit stands. That is the safe direction to fail: the user is owed,
    // not overpaid, and the same payout id can be replayed to settle it.
    await recordPayment({ payoutId, userId: input.userId, to, amountMicro: input.amountMicro, txId: `failed:${payoutId}`, status: 'failed' });
    throw new AppError('upstream_unavailable', 'Payout could not be submitted; it will be retried', {
      payoutId,
      cause: (cause as Error).message,
    });
  }

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  const status = receipt.status === 'success' ? 'confirmed' : 'failed';

  await recordPayment({ payoutId, userId: input.userId, to, amountMicro: input.amountMicro, txId: txHash, status });

  if (status === 'failed') {
    throw new AppError('upstream_unavailable', 'Payout transaction reverted', { payoutId, txHash });
  }

  return {
    payoutId,
    txHash,
    amountMicro: input.amountMicro,
    to,
    explorerUrl: `${env().EXPLORER_URL}/transaction/${txHash}`,
  };
}

async function recordPayment(args: {
  payoutId: string;
  userId: string;
  to: string;
  amountMicro: bigint;
  txId: string;
  status: 'confirmed' | 'failed';
}): Promise<void> {
  await prisma.payment.create({
    data: {
      kind: 'reward_payout',
      network: `eip155:${env().CHAIN_ID}`,
      txId: args.txId,
      fromAddress: env().REWARD_POOL_ADDRESS ?? '',
      toAddress: args.to,
      asset: env().USDC_ADDRESS,
      amountRaw: args.amountMicro.toString(),
      amountMicro: args.amountMicro,
      status: args.status,
      userId: args.userId,
      requestId: args.payoutId,
      confirmedAt: args.status === 'confirmed' ? new Date() : null,
      raw: { payoutId: args.payoutId },
    },
  });
}
