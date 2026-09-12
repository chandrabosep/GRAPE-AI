import { config as loadEnv } from 'dotenv';
import { x402Client } from '@x402/core/client';
import { decodePaymentResponseHeader } from '@x402/core/http';
import { wrapFetchWithPayment } from '@x402/fetch';
import { PrivateKey, createClientHederaSigner } from '@x402/hedera';
import { ExactHederaScheme } from '@x402/hedera/exact/client';

loadEnv({ path: new URL('../../../.env', import.meta.url).pathname, quiet: true });

interface DiscoveryResource {
  id: string;
  url: string;
  maxOutputTokens: number;
  price: { amountHbar: string };
}

interface InferenceResponse {
  text: string;
  usage: { inputTokens: number; outputTokens: number };
  requestId: string;
  tier: string;
  payment: { amountHbar: string };
}

const API = process.env.X402_API_URL ?? 'http://localhost:4402';
const NETWORK = (process.env.X402_NETWORK ?? 'hedera:testnet') as `${string}:${string}`;

/** x402's asset id for native HBAR. */
const HBAR_ASSET = '0.0.0';

/** The most this agent will pay for any single call, in tinybars. */
const MAX_TINYBARS = process.env.X402_AGENT_MAX_TINYBARS ?? '5000000';

/**
 * Hedera portal hands out ECDSA keys in two shapings — DER and bare hex — and
 * which one you get depends on where you copied it from, so accept either
 * rather than making the operator figure out the difference.
 */
function parseKey(raw: string): PrivateKey {
  const trimmed = raw.trim();
  // A bare 32-byte hex key, with or without the 0x, is ECDSA; anything longer
  // carries a DER prefix. Choosing by shape rather than by try/catch keeps the
  // SDK from printing a deprecation warning on every run.
  return /^(0x)?[0-9a-fA-F]{64}$/.test(trimmed)
    ? PrivateKey.fromStringECDSA(trimmed)
    : PrivateKey.fromStringDer(trimmed);
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set — create a testnet account at https://portal.hedera.com`);
  return value;
}

function step(n: number, text: string): void {
  console.log(`\n\x1b[36m[${n}]\x1b[0m ${text}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  // The tier is the agent's call, not the server's: same service, same signing
  // path, a different price for a bigger output ceiling.
  const useLarge = args.includes('--large');
  const route = useLarge ? '/v1/inference/large' : '/v1/inference';
  const prompt = args.filter((a) => a !== '--large').join(' ').trim();
  if (!prompt) {
    console.error('usage: pnpm --filter @aam/agent-demo start [--large] "<your prompt>"');
    process.exit(1);
  }

  const accountId = required('HEDERA_AGENT_ACCOUNT_ID');
  const signer = createClientHederaSigner(accountId, parseKey(required('HEDERA_AGENT_PRIVATE_KEY')), {
    network: NETWORK,
  });

  // x402's "default assets" are the USD-pegged stablecoins, so HBAR is not one
  // and the client's spend controls reject it until it is named. Naming it with
  // a cap is the better answer regardless: the agent carries a hard per-call
  // budget it cannot exceed, whatever price a server quotes back at it.
  const client = x402Client.fromConfig({
    schemes: [{ network: NETWORK, client: new ExactHederaScheme(signer) }],
    spendControls: {
      allowedAssets: [
        { network: NETWORK, asset: HBAR_ASSET, maxAmountPerPayment: MAX_TINYBARS },
      ],
    },
  });
  const pay = wrapFetchWithPayment(fetch, client);

  // 1. Discovery is free, and that is the point: an agent can find the service,
  //    read its terms and decide, without an account or an API key.
  step(1, `Discovering ${API}/.well-known/x402`);
  const discovery = (await fetch(`${API}/.well-known/x402`).then((r) => r.json())) as {
    resources: DiscoveryResource[];
  };
  for (const resource of discovery.resources) {
    console.log(`    ${resource.id.padEnd(6)} ${resource.price.amountHbar} HBAR  ≤${resource.maxOutputTokens} tokens  ${resource.url}`);
  }

  // 2. Unpaid call, to show the 402 terms the agent is about to satisfy.
  step(2, `Calling ${route} without payment to read the 402`);
  const unpaid = await fetch(`${API}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: prompt }] }),
  });
  console.log(`    HTTP ${unpaid.status}`);
  const required402 = unpaid.headers.get('PAYMENT-REQUIRED');
  if (required402) console.log(`    PAYMENT-REQUIRED present (${required402.length} bytes)`);

  // 3. The same call through the paying fetch: 402 → build and sign a Hedera
  //    TransferTransaction → retry with PAYMENT-SIGNATURE → answer.
  step(3, `Paying and retrying as ${accountId} (budget ${MAX_TINYBARS} tinybars/call)`);
  const started = Date.now();
  const response = await pay(`${API}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: prompt }] }),
  });

  if (!response.ok) {
    console.error(`    HTTP ${response.status}: ${await response.text()}`);
    process.exit(1);
  }

  const body = (await response.json()) as InferenceResponse;
  console.log(`    HTTP ${response.status} in ${Date.now() - started}ms`);

  step(4, 'Answer');
  console.log(
    body.text
      .split('\n')
      .map((line) => `    ${line}`)
      .join('\n'),
  );

  step(5, 'Settlement');
  console.log(`    tokens      ${body.usage.inputTokens} in / ${body.usage.outputTokens} out`);
  console.log(`    tier        ${body.tier}`);
  console.log(`    price       ${body.payment.amountHbar} HBAR`);
  console.log(`    requestId   ${body.requestId}`);

  const header = response.headers.get('PAYMENT-RESPONSE') ?? response.headers.get('X-PAYMENT-RESPONSE');
  if (!header) {
    console.log('    no PAYMENT-RESPONSE header returned');
    return;
  }

  const settled = decodePaymentResponseHeader(header);
  console.log(`    payer       ${settled.payer ?? 'unknown'}`);
  console.log(`    txId        ${settled.transaction}`);
  console.log(`\n    \x1b[32mhttps://hashscan.io/testnet/transaction/${settled.transaction}\x1b[0m\n`);
}

main().catch((error: unknown) => {
  console.error(`\n\x1b[31magent-demo failed:\x1b[0m ${(error as Error).message}\n`);
  process.exit(1);
});
