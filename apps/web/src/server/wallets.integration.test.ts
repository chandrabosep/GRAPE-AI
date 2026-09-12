import { linkMessage } from '@aam/shared';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestDatabase, type TestDatabase } from '../../test/db';

/**
 * Wallet linking — the signal source, proved rather than claimed.
 *
 * Onchain targeting follows the linked address, so the only thing standing
 * between a user and a whale's audience signals is this signature check. The
 * cases below are the ways someone would try to skip it: a typed address, a
 * captured signature replayed, and a signature over text that is not the
 * linking message at all.
 */

let database: TestDatabase;
type Modules = {
  prisma: typeof import('@aam/db').prisma;
  siwe: typeof import('./modules/auth/siwe');
  users: typeof import('./modules/users/service');
  wallets: typeof import('./modules/wallets/service');
};
let m: Modules;

async function newUser(): Promise<string> {
  const account = privateKeyToAccount(generatePrivateKey());
  const user = await m.users.upsertFromIdentity({
    subject: m.siwe.walletSubject(account.address.toLowerCase()),
  });
  return user.id;
}

/** What the browser does: fetch a nonce, sign the exact linking message. */
async function signLink(account: ReturnType<typeof privateKeyToAccount>) {
  const nonce = await m.siwe.issueNonce();
  const message = linkMessage(account.address, nonce);
  return { message, signature: await account.signMessage({ message }) };
}

beforeAll(async () => {
  database = await startTestDatabase();
  process.env.DATABASE_URL = database.connectionString;
  process.env.DIRECT_URL = database.connectionString;

  m = {
    prisma: (await import('@aam/db')).prisma,
    siwe: await import('./modules/auth/siwe'),
    users: await import('./modules/users/service'),
    wallets: await import('./modules/wallets/service'),
  };
}, 60_000);

afterAll(async () => {
  await m?.prisma.$disconnect();
  await database?.stop();
});

describe('wallet linking', () => {
  it('links a wallet the user can prove they control', async () => {
    const userId = await newUser();
    const account = privateKeyToAccount(generatePrivateKey());
    const { message, signature } = await signLink(account);

    const wallet = await m.wallets.linkWallet({
      userId,
      address: account.address,
      chainType: 'evm',
      message,
      signature,
    });

    expect(wallet.address).toBe(account.address.toLowerCase());
    expect(wallet.isPrimarySignalSource).toBe(true);
    expect(wallet.verifiedAt).not.toBeNull();

    const listed = await m.wallets.listWallets(userId);
    expect(listed).toHaveLength(1);
  }, 30_000);

  it('refuses a replayed signature', async () => {
    const userId = await newUser();
    const account = privateKeyToAccount(generatePrivateKey());
    const { message, signature } = await signLink(account);

    await m.wallets.linkWallet({
      userId,
      address: account.address,
      chainType: 'evm',
      message,
      signature,
    });

    // The nonce is burned, so the identical payload — captured in flight, or
    // replayed onto a second account — cannot be used again.
    await expect(
      m.wallets.linkWallet({
        userId: await newUser(),
        address: account.address,
        chainType: 'evm',
        message,
        signature,
      }),
    ).rejects.toThrow(/expired/i);
  }, 30_000);

  it('refuses an address the signer does not control', async () => {
    const userId = await newUser();
    const whale = privateKeyToAccount(generatePrivateKey());
    const attacker = privateKeyToAccount(generatePrivateKey());

    const nonce = await m.siwe.issueNonce();
    const message = linkMessage(whale.address, nonce);
    const signature = await attacker.signMessage({ message });

    await expect(
      m.wallets.linkWallet({
        userId,
        address: whale.address,
        chainType: 'evm',
        message,
        signature,
      }),
    ).rejects.toThrow(/does not match/i);
  }, 30_000);

  it('refuses a signature over anything but the linking message', async () => {
    const userId = await newUser();
    const account = privateKeyToAccount(generatePrivateKey());
    const nonce = await m.siwe.issueNonce();

    // Correctly signed, by the right key, naming the right address — but not
    // the message we issue. Accepting it would let a signature gathered for
    // some other purpose be redeemed here.
    const message = `Approve transfer\n\nAddress: ${account.address}\nNonce: ${nonce}`;
    const signature = await account.signMessage({ message });

    await expect(
      m.wallets.linkWallet({
        userId,
        address: account.address,
        chainType: 'evm',
        message,
        signature,
      }),
    ).rejects.toThrow(/not the wallet-linking message/i);
  }, 30_000);

  it('moves the signal source when a second wallet is linked, and deletes it on unlink', async () => {
    const userId = await newUser();
    const first = privateKeyToAccount(generatePrivateKey());
    const second = privateKeyToAccount(generatePrivateKey());

    const a = await signLink(first);
    const walletA = await m.wallets.linkWallet({
      userId,
      address: first.address,
      chainType: 'evm',
      message: a.message,
      signature: a.signature,
    });

    const b = await signLink(second);
    const walletB = await m.wallets.linkWallet({
      userId,
      address: second.address,
      chainType: 'evm',
      message: b.message,
      signature: b.signature,
    });

    // Exactly one wallet may feed targeting, or two sets of signals would
    // compete and the ad engine would have to guess.
    const listed = await m.wallets.listWallets(userId);
    expect(listed.filter((w) => w.isPrimarySignalSource)).toHaveLength(1);
    expect(listed.find((w) => w.isPrimarySignalSource)?.id).toBe(walletB.id);

    await m.wallets.unlinkWallet(userId, walletA.id);
    expect(await m.wallets.listWallets(userId)).toHaveLength(1);
  }, 30_000);

  it('refuses to unlink a wallet belonging to someone else', async () => {
    const owner = await newUser();
    const stranger = await newUser();
    const account = privateKeyToAccount(generatePrivateKey());
    const { message, signature } = await signLink(account);

    const wallet = await m.wallets.linkWallet({
      userId: owner,
      address: account.address,
      chainType: 'evm',
      message,
      signature,
    });

    await expect(m.wallets.unlinkWallet(stranger, wallet.id)).rejects.toThrow(/not found/i);
  }, 30_000);
});
