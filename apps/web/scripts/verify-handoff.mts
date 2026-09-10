/**
 * Exercises the whole browser-to-editor sign-in without a browser or a wallet.
 *
 * A local key signs exactly what MetaMask would sign, so this covers the real
 * path: SIWE sign-in, minting a single-use handoff code, redeeming it for an
 * editor session, and confirming that code cannot be redeemed twice.
 */
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createSiweMessage } from 'viem/siwe';

const BASE = process.env.API_URL ?? 'http://localhost:3000';
const DOMAIN = new URL(BASE).host;

const post = async (path: string, body: unknown, token?: string) => {
  const response = await fetch(`${BASE}/api/v1${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
};

const account = privateKeyToAccount(generatePrivateKey());
console.log(`wallet   ${account.address}`);

const { nonce } = await (await fetch(`${BASE}/api/v1/auth/siwe/nonce`)).json();

const message = createSiweMessage({
  address: account.address,
  chainId: 84532,
  domain: DOMAIN,
  nonce,
  uri: BASE,
  version: '1',
  statement: 'Sign in to AI Attention Marketplace.',
  issuedAt: new Date(),
  expirationTime: new Date(Date.now() + 600_000),
});

const signIn = await post('/auth/siwe/verify', {
  message,
  signature: await account.signMessage({ message }),
});
if (signIn.status !== 200) {
  console.error('sign-in failed', signIn.body);
  process.exit(1);
}
console.log(`web session   ok, credits ${signIn.body.user.creditBalanceMicro}`);

// The extension generates this and waits for it to come back.
const state = crypto.randomUUID();

const minted = await post('/auth/vscode/code', { state }, signIn.body.accessToken);
if (minted.status !== 200) {
  console.error('mint failed', minted.body);
  process.exit(1);
}
console.log(`handoff code  minted, expires in ${minted.body.expiresInSeconds}s`);

const exchanged = await post('/auth/vscode/exchange', { code: minted.body.code, state });
if (exchanged.status !== 200) {
  console.error('exchange failed', exchanged.body);
  process.exit(1);
}
console.log('editor session ok');

const me = await fetch(`${BASE}/api/v1/me`, {
  headers: { authorization: `Bearer ${exchanged.body.accessToken}` },
});
console.log(`editor /me    ${me.status === 200 ? 'authorised' : 'FAILED'}`);

const replay = await post('/auth/vscode/exchange', { code: minted.body.code, state });
console.log(`replay        ${replay.status === 401 ? 'rejected (correct)' : `NOT REJECTED (${replay.status})`}`);

const wrongState = await post('/auth/vscode/code', { state: 'x'.repeat(20) }, signIn.body.accessToken);
const mismatched = await post('/auth/vscode/exchange', {
  code: wrongState.body.code,
  state: 'different-state-entirely',
});
console.log(`state mismatch ${mismatched.status === 401 ? 'rejected (correct)' : `NOT REJECTED (${mismatched.status})`}`);
