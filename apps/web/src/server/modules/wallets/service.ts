import { prisma, type Wallet, transaction } from '@aam/db';
import { AppError, linkMessage, parseLinkNonce } from '@aam/shared';
import { verifyMessage } from 'viem';
import { logger } from '../../lib/logger';
import { consumeNonce } from '../auth/siwe';
import { refreshSignalsForWallet } from '../graph/service';

/**
 * Wallet linking.
 *
 * Targeting signals come from a wallet the user has *proved* they control, never
 * from an address they merely typed. Without the signature check anyone could
 * claim a whale's address and inherit its audience signals, which would make
 * onchain targeting meaningless and let someone farm campaigns that require
 * DeFi history.
 *
 * The embedded wallet Privy creates is brand new and has no history, so the
 * signal source is normally a linked mainnet wallet.
 */

export interface LinkWalletInput {
  userId: string;
  address: string;
  chainType: 'evm' | 'hedera';
  message: string;
  signature: string;
}

export async function linkWallet(input: LinkWalletInput): Promise<Wallet> {
  if (input.chainType !== 'evm') {
    throw new AppError('validation_failed', 'Only EVM wallets can be linked as a signal source');
  }

  const address = input.address.toLowerCase();

  // The signed text must be exactly the message we issue, for exactly this
  // address. Accepting anything that merely mentions the address would let a
  // signature collected elsewhere — or one the user was tricked into producing
  // for a different purpose — be submitted here.
  const nonce = parseLinkNonce(input.message);
  if (!nonce) {
    throw new AppError('validation_failed', 'Signed message is missing its nonce');
  }

  const expected = [linkMessage(input.address, nonce), linkMessage(address, nonce)];
  if (!expected.includes(input.message)) {
    throw new AppError('validation_failed', 'Signed message is not the wallet-linking message');
  }

  const valid = await verifyMessage({
    address: input.address as `0x${string}`,
    message: input.message,
    signature: input.signature as `0x${string}`,
  }).catch(() => false);

  if (!valid) {
    throw new AppError('unauthorized', 'Signature does not match this address');
  }

  // Burned only after the signature checks out, so a bad signature cannot spend
  // someone else's nonce. A replay of a valid signature finds the nonce already
  // used and is refused here.
  if (!(await consumeNonce(nonce))) {
    throw new AppError('unauthorized', 'This link request has expired. Try again.');
  }

  const existing = await prisma.wallet.findUnique({
    where: { address_chainType: { address, chainType: 'evm' } },
  });

  if (existing && existing.userId !== input.userId) {
    throw new AppError('forbidden', 'This wallet is already linked to another account');
  }

  const wallet = await transaction(async (tx) => {
    // Exactly one wallet feeds targeting, so clear the flag before setting it.
    await tx.wallet.updateMany({
      where: { userId: input.userId, isPrimarySignalSource: true },
      data: { isPrimarySignalSource: false },
    });

    return tx.wallet.upsert({
      where: { address_chainType: { address, chainType: 'evm' } },
      create: {
        userId: input.userId,
        address,
        chainType: 'evm',
        kind: 'linked_external',
        isPrimarySignalSource: true,
        verifiedAt: new Date(),
      },
      update: { isPrimarySignalSource: true, verifiedAt: new Date() },
    });
  });

  // Warm the cache so the next chat request has signals without a fan-out.
  refreshSignalsForWallet(input.userId, wallet.id, wallet.address).catch((error: unknown) => {
    logger.warn({ err: error, walletId: wallet.id }, 'initial signal refresh failed');
  });

  return wallet;
}

export async function listWallets(userId: string) {
  return prisma.wallet.findMany({
    where: { userId },
    // `sources` rides along because the user is entitled to see which Graph
    // product produced each signal, not just the verdict.
    include: {
      signals: {
        select: { signals: true, sources: true, computedAt: true, expiresAt: true },
      },
    },
    orderBy: { createdAt: 'asc' },
  });
}

/** Lets a user see and refresh exactly what advertisers can target them on. */
export async function refreshWalletSignals(userId: string, walletId: string) {
  const wallet = await prisma.wallet.findUnique({ where: { id: walletId } });
  if (!wallet || wallet.userId !== userId) {
    throw new AppError('not_found', 'Wallet not found');
  }

  const signals = await refreshSignalsForWallet(userId, wallet.id, wallet.address);

  // Read the row back rather than returning the signals alone: the provenance
  // and the freshness window are what make the panel honest about how this was
  // derived and when it stops being true.
  const stored = await prisma.onchainSignal.findUnique({
    where: { walletId: wallet.id },
    select: { sources: true, computedAt: true, expiresAt: true },
  });

  return { signals, ...stored };
}

export async function unlinkWallet(userId: string, walletId: string): Promise<void> {
  const wallet = await prisma.wallet.findUnique({ where: { id: walletId } });
  if (!wallet || wallet.userId !== userId) {
    throw new AppError('not_found', 'Wallet not found');
  }

  // Removing the wallet removes the cached signals with it, by cascade.
  await prisma.wallet.delete({ where: { id: walletId } });
}
