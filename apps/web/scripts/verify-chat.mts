/** Drives one full chat request the way the extension does, and reports what came back. */
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createSiweMessage } from 'viem/siwe';

const BASE = process.env.API_URL ?? 'http://localhost:3001';
const account = privateKeyToAccount(generatePrivateKey());

const { nonce } = await (await fetch(`${BASE}/api/v1/auth/siwe/nonce`)).json();
const message = createSiweMessage({
  address: account.address,
  chainId: 84532,
  domain: new URL(BASE).host,
  nonce,
  uri: BASE,
  version: '1',
  issuedAt: new Date(),
  expirationTime: new Date(Date.now() + 600_000),
});

const session = await (
  await fetch(`${BASE}/api/v1/auth/siwe/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message, signature: await account.signMessage({ message }) }),
  })
).json();

if (!session.accessToken) {
  console.error('sign-in failed:', session);
  process.exit(1);
}
console.log(`signed in, credits ${session.user.creditBalanceMicro}`);

const response = await fetch(`${BASE}/api/v1/ai/chat`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${session.accessToken}` },
  body: JSON.stringify({
    messages: [{ role: 'user', content: 'How do I deploy this Solidity contract using Foundry?' }],
    hints: { languageId: 'solidity' },
  }),
});

const reader = response.body!.getReader();
const decoder = new TextDecoder();
const seen: Record<string, number> = {};
let answer = '';
let impressionId: string | null = null;
let buffer = '';

for (;;) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  let i;
  while ((i = buffer.indexOf('\n\n')) !== -1) {
    const frame = buffer.slice(0, i);
    buffer = buffer.slice(i + 2);
    const line = frame.split('\n').find((l) => l.startsWith('data:'));
    if (!line) continue;
    const event = JSON.parse(line.slice(5).trim());
    seen[event.type] = (seen[event.type] ?? 0) + 1;
    if (event.type === 'delta') answer += event.text;
    if (event.type === 'ad') impressionId = event.ad.impressionId;
    if (event.type === 'error') console.error('  STREAM ERROR:', event.code, event.message);
  }
}

console.log('events:', Object.entries(seen).map(([k, v]) => `${k}×${v}`).join(' '));
console.log('answer:', answer.slice(0, 80).replace(/\n/g, ' ') + (answer ? '…' : '(none)'));

if (impressionId) {
  const ack = await fetch(`${BASE}/api/v1/ads/impressions/${impressionId}/ack`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${session.accessToken}` },
    body: JSON.stringify({ visibleMs: 1500 }),
  });
  console.log('ad reward:', JSON.stringify(await ack.json()));
}

const me = await (
  await fetch(`${BASE}/api/v1/me`, { headers: { authorization: `Bearer ${session.accessToken}` } })
).json();
console.log(`final credits ${me.credits.balanceMicro} (started 500000)`);
