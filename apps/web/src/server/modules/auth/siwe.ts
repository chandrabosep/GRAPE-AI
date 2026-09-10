import { prisma } from '@aam/db';
import { AppError } from '@aam/shared';
import { createPublicClient, http } from 'viem';
// SIWE helpers live in viem's ./siwe subpath, not the root export.
import {
  generateSiweNonce,
  parseSiweMessage,
  verifySiweMessage,
  type SiweMessage,
} from 'viem/siwe';
import { env } from '../../config/index';
import { logger } from '../../lib/logger';

/**
 * Sign-In With Ethereum.
 *
 * The wallet is the identity. A developer proves control of an address by
 * signing a message we issued, and gets a session keyed to `wallet:0x…`.
 *
 * SIWE's replay protection rests entirely on the nonce being issued by the
 * server and accepted exactly once, so nonces are stored and burned rather than
 * derived. Everything else that must be checked — domain, expiry, address — is
 * checked here rather than trusted from the message body, because the message is
 * supplied by the caller.
 */

const NONCE_TTL_MS = 10 * 60 * 1000;

export async function issueNonce(): Promise<string> {
  const nonce = generateSiweNonce();

  await prisma.authNonce.create({
    data: { nonce, expiresAt: new Date(Date.now() + NONCE_TTL_MS) },
  });

  return nonce;
}

/** Burns a nonce, returning false if it was unknown, expired or already used. */
async function consumeNonce(nonce: string): Promise<boolean> {
  // Conditional update, so two simultaneous verifications cannot both win.
  const result = await prisma.authNonce.updateMany({
    where: { nonce, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });
  return result.count === 1;
}

function expectedDomain(): string {
  try {
    return new URL(env().NEXT_PUBLIC_APP_URL).host;
  } catch {
    return 'localhost:3000';
  }
}

export interface VerifiedWallet {
  address: string;
  chainId: number;
}

/**
 * Verifies a signed SIWE message.
 *
 * Uses a public client so smart-contract wallets verifying via EIP-1271 work as
 * well as plain EOAs.
 */
export async function verifySiwe(message: string, signature: string): Promise<VerifiedWallet> {
  let parsed: SiweMessage;
  try {
    parsed = parseSiweMessage(message) as SiweMessage;
  } catch {
    throw new AppError('unauthorized', 'Malformed sign-in message');
  }

  if (!parsed.address || !parsed.nonce) {
    throw new AppError('unauthorized', 'Sign-in message is missing required fields');
  }

  if (!(await consumeNonce(parsed.nonce))) {
    throw new AppError('unauthorized', 'This sign-in request has expired. Try again.');
  }

  // verifySiweMessage covers EOAs, EIP-1271 smart wallets and ERC-6492
  // counterfactual accounts, which is why it needs a client and an RPC call.
  // It checks address, domain, nonce and the expiry window against `time`.
  const client = createPublicClient({ transport: http(env().RPC_URL) });

  const verified = await client
    .verifySiweMessage({
      message,
      signature: signature as `0x${string}`,
      domain: expectedDomain(),
      nonce: parsed.nonce,
      address: parsed.address,
      time: new Date(),
    })
    .catch((error: unknown) => {
      logger.warn({ err: error }, 'siwe verification errored');
      return false;
    });

  if (!verified) {
    throw new AppError('unauthorized', 'Signature does not match the address');
  }

  // verifySiweMessage deliberately does not check chainId, so it is checked here.
  const chainId = parsed.chainId;
  if (chainId === undefined) {
    throw new AppError('unauthorized', 'Sign-in message did not declare a chain');
  }

  return { address: parsed.address.toLowerCase(), chainId };
}

/** Identity subject for a wallet. Prefixed so providers can never collide. */
export function walletSubject(address: string): string {
  return `wallet:${address.toLowerCase()}`;
}

export async function purgeExpiredNonces(): Promise<number> {
  const result = await prisma.authNonce.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return result.count;
}
