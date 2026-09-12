import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { createSiweMessage } from 'viem/siwe';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestDatabase, type TestDatabase } from '../../test/db';

/**
 * Wallet sign-in, exercised with a real key rather than a browser.
 *
 * A local account signs exactly what a wallet would sign, so the whole path is
 * covered: nonce issuance, signature verification, nonce burning, and the
 * replay attempt that has to fail.
 */

let database: TestDatabase;
type Modules = {
  prisma: typeof import('@aam/db').prisma;
  siwe: typeof import('./modules/auth/siwe');
  users: typeof import('./modules/users/service');
};
let m: Modules;

const DOMAIN = 'localhost:3001';

async function signIn(account: ReturnType<typeof privateKeyToAccount>, nonce: string) {
  const message = createSiweMessage({
    address: account.address,
    chainId: 84532,
    domain: DOMAIN,
    nonce,
    uri: `http://${DOMAIN}`,
    version: '1',
    statement: 'Sign in to GRAPE AI.',
    issuedAt: new Date(),
    expirationTime: new Date(Date.now() + 10 * 60 * 1000),
  });

  const signature = await account.signMessage({ message });
  return { message, signature };
}

beforeAll(async () => {
  database = await startTestDatabase();
  process.env.DATABASE_URL = database.connectionString;
  process.env.DIRECT_URL = database.connectionString;
  process.env.NEXT_PUBLIC_APP_URL = `http://${DOMAIN}`;

  m = {
    prisma: (await import('@aam/db')).prisma,
    siwe: await import('./modules/auth/siwe'),
    users: await import('./modules/users/service'),
  };
}, 60_000);

afterAll(async () => {
  await m?.prisma.$disconnect();
  await database?.stop();
});

describe('sign in with ethereum', () => {
  it('accepts a correctly signed message and creates the account', async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const nonce = await m.siwe.issueNonce();
    const { message, signature } = await signIn(account, nonce);

    const verified = await m.siwe.verifySiwe(message, signature);
    expect(verified.address).toBe(account.address.toLowerCase());
    expect(verified.chainId).toBe(84532);

    const user = await m.users.upsertFromIdentity({
      subject: m.siwe.walletSubject(verified.address),
    });
    expect(user.subject).toBe(`wallet:${account.address.toLowerCase()}`);

    // A new wallet gets the starter grant that breaks the cold-start loop.
    expect(user.creditBalanceMicro).toBeGreaterThan(0n);
  }, 30_000);

  it('refuses a replayed message', async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const nonce = await m.siwe.issueNonce();
    const { message, signature } = await signIn(account, nonce);

    await m.siwe.verifySiwe(message, signature);

    // Same signature, same nonce: the nonce is burned, so this must fail.
    await expect(m.siwe.verifySiwe(message, signature)).rejects.toThrow(/expired/i);
  }, 30_000);

  it('refuses a nonce the server never issued', async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const { message, signature } = await signIn(account, 'deadbeefdeadbeef');

    await expect(m.siwe.verifySiwe(message, signature)).rejects.toThrow(/expired/i);
  }, 30_000);

  it('refuses a signature from a different wallet', async () => {
    const claimed = privateKeyToAccount(generatePrivateKey());
    const attacker = privateKeyToAccount(generatePrivateKey());
    const nonce = await m.siwe.issueNonce();

    const message = createSiweMessage({
      address: claimed.address,
      chainId: 84532,
      domain: DOMAIN,
      nonce,
      uri: `http://${DOMAIN}`,
      version: '1',
      issuedAt: new Date(),
      expirationTime: new Date(Date.now() + 600_000),
    });

    // Attacker signs a message claiming someone else's address.
    const signature = await attacker.signMessage({ message });

    await expect(m.siwe.verifySiwe(message, signature)).rejects.toThrow(/does not match/i);
  }, 30_000);

  it('refuses a message issued for another site', async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const nonce = await m.siwe.issueNonce();

    const message = createSiweMessage({
      address: account.address,
      chainId: 84532,
      domain: 'evil.example',
      nonce,
      uri: 'https://evil.example',
      version: '1',
      issuedAt: new Date(),
      expirationTime: new Date(Date.now() + 600_000),
    });
    const signature = await account.signMessage({ message });

    await expect(m.siwe.verifySiwe(message, signature)).rejects.toThrow();
  }, 30_000);

  it('refuses an expired message', async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const nonce = await m.siwe.issueNonce();

    const message = createSiweMessage({
      address: account.address,
      chainId: 84532,
      domain: DOMAIN,
      nonce,
      uri: `http://${DOMAIN}`,
      version: '1',
      issuedAt: new Date(Date.now() - 20 * 60 * 1000),
      expirationTime: new Date(Date.now() - 60_000),
    });
    const signature = await account.signMessage({ message });

    await expect(m.siwe.verifySiwe(message, signature)).rejects.toThrow();
  }, 30_000);
});
