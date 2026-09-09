import { prisma, type Wallet } from '@aam/db';
import { AppError } from '@aam/shared';
import { verifyMessage } from 'viem';
import { logger } from '../../lib/logger';
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

/** The exact text the user signs. Includes the address so a signature cannot be replayed for another. */
export function linkMessage(address: string, nonce: string): string {
  return [
    'Link this wallet to your AI Attention Marketplace account.',
    '',
    `Address: ${address}`,
    `Nonce: ${nonce}`,
    '',
    'This proves you control the wallet. It grants no spending permission.',
  ].join('\n');
}

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

  // The message must name the address being claimed, or a signature captured
  // elsewhere could be replayed to claim a different one.
  if (!input.message.includes(input.address) && !input.message.includes(address)) {
    throw new AppError('validation_failed', 'Signed message does not reference this address');
  }

  const valid = await verifyMessage({
    address: input.address as `0x${string}`,
    message: input.message,
    signature: input.signature as `0x${string}`,
  }).catch(() => false);

  if (!valid) {
    throw new AppError('unauthorized', 'Signature does not match this address');
  }

  const existing = await prisma.wallet.findUnique({
    where: { address_chainType: { address, chainType: 'evm' } },
  });

  if (existing && existing.userId !== input.userId) {
    throw new AppError('forbidden', 'This wallet is already linked to another account');
  }

  const wallet = await prisma.$transaction(async (tx) => {
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
    include: { signals: { select: { signals: true, computedAt: true, expiresAt: true } } },
    orderBy: { createdAt: 'asc' },
  });
}

/** Lets a user see and refresh exactly what advertisers can target them on. */
export async function refreshWalletSignals(userId: string, walletId: string) {
  const wallet = await prisma.wallet.findUnique({ where: { id: walletId } });
  if (!wallet || wallet.userId !== userId) {
    throw new AppError('not_found', 'Wallet not found');
  }

  return refreshSignalsForWallet(userId, wallet.id, wallet.address);
}

export async function unlinkWallet(userId: string, walletId: string): Promise<void> {
  const wallet = await prisma.wallet.findUnique({ where: { id: walletId } });
  if (!wallet || wallet.userId !== userId) {
    throw new AppError('not_found', 'Wallet not found');
  }

  // Removing the wallet removes the cached signals with it, by cascade.
  await prisma.wallet.delete({ where: { id: walletId } });
}
