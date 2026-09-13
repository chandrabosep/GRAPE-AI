import type { Metadata } from 'next';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Code, CodeBlock } from '@/components/app/code-block';
import { Eyebrow, Section, Shell, Stamp } from '@/components/app/section';
import { env } from '@/server/config/index';

export const metadata: Metadata = {
  title: 'For agents',
  description:
    'Pay per call for LLM inference over x402 on Hedera. No account, no subscription, no API key.',
};

/** x402's asset id for native HBAR. */
const HBAR_ASSET = '0.0.0';

const TINYBARS_PER_HBAR = 100_000_000n;

/**
 * Display only — the wire always carries tinybars as an integer string.
 *
 * A mirror of `toHbar` in `apps/x402-api/src/pricing.ts`. The web app does not
 * import from the x402 service because the two deploy independently, and a
 * documentation page that cannot render when the paid service is down is worse
 * than one that quotes a number from the same environment variable.
 */
function toHbar(tinybars: bigint): string {
  const whole = tinybars / TINYBARS_PER_HBAR;
  const frac = (tinybars % TINYBARS_PER_HBAR).toString().padStart(8, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : `${whole}`;
}

interface Tier {
  id: string;
  path: string;
  maxOutputTokens: number;
  tinybars: bigint;
  blurb: string;
}

/**
 * Prose for each tier, keyed by the id discovery uses.
 *
 * The service publishes a one-line `description`, which says what the tier is
 * ("LLM inference, up to 512 output tokens") and not what it is for. That
 * second thing is the only part of a tier this page is the right author of, so
 * it is the only part kept here.
 */
const TIER_BLURBS: Record<string, string> = {
  small: 'Answers, lookups, classification — anything that fits in a paragraph or two.',
  large: 'Long-form generation, file-sized output, extended reasoning.',
};

/** The shape of `/.well-known/x402`, narrowed to what this page renders. */
interface Discovery {
  network: string;
  payTo: string;
  facilitator: string;
  resources: {
    id: string;
    url: string;
    maxOutputTokens: number;
    price: { amount: string; amountHbar: string };
  }[];
}

/**
 * The live terms, straight from the service.
 *
 * Documentation that quotes a price is documentation that can be wrong about
 * one, and the only copy that cannot drift is the service's own. So the page is
 * built from discovery — the same free endpoint it tells agents to read — and
 * revalidated every five minutes rather than pinned at deploy time.
 *
 * Every failure lands on the environment-derived fallback below instead of
 * throwing. A reference page has to render when the thing it documents is down;
 * that is when somebody is most likely to be reading it.
 */
async function loadDiscovery(base: string): Promise<Discovery | null> {
  try {
    const response = await fetch(`${base}/.well-known/x402`, {
      // Long enough to survive a cold start on the serverless host, short
      // enough that a hung service cannot hold a page render open.
      signal: AbortSignal.timeout(5_000),
      next: { revalidate: 300 },
    });
    if (!response.ok) return null;

    const body = (await response.json()) as Partial<Discovery>;
    // A reachable host that is not this service — a tunnel pointed elsewhere,
    // a parked domain — answers 200 with something else entirely.
    if (!Array.isArray(body.resources) || body.resources.length === 0) return null;
    if (!body.network || !body.payTo) return null;

    return body as Discovery;
  } catch {
    return null;
  }
}

/**
 * What the tiers are when discovery could not be read.
 *
 * The base price is not guessed — it comes from `X402_PRICE_HBAR_TINYBARS`,
 * the same variable the service prices from. Only the multiplier and the
 * ceilings are mirrored from `apps/x402-api/src/pricing.ts`, and they are the
 * reason this is a fallback rather than the source.
 */
function fallbackTiers(base: bigint): Tier[] {
  return [
    { id: 'small', path: '/v1/inference', maxOutputTokens: 512, tinybars: base, blurb: TIER_BLURBS.small! },
    { id: 'large', path: '/v1/inference/large', maxOutputTokens: 4096, tinybars: base * 5n, blurb: TIER_BLURBS.large! },
  ];
}

const REQUIREMENTS = [
  {
    index: '01',
    title: 'A Hedera testnet account',
    body: 'An ECDSA account from portal.hedera.com. It arrives funded, and creating one takes about a minute. You need the account id and its private key.',
  },
  {
    index: '02',
    title: 'HBAR, and only for the price',
    body: 'The facilitator signs as fee payer, announced as extra.feePayer in the 402, so your balance covers what you are buying and nothing else. There is no gas to budget for.',
  },
  {
    index: '03',
    title: 'An x402 client',
    body: 'The @x402 packages for JavaScript are shown below. Any client that speaks x402 v2 and the exact scheme on hedera:testnet will work — nothing here is specific to ours.',
  },
];

/** The paid request, as five legs. Mirrors the shape the landing page uses. */
const HANDSHAKE = [
  {
    code: 'ASK',
    body: 'You POST to a paid route with no credentials. Nothing is charged and nothing is run.',
  },
  {
    code: '402',
    body: 'The service answers 402 with its terms in the PAYMENT-REQUIRED header: scheme, network, asset, amount, who to pay and who pays the fee.',
  },
  {
    code: 'SIGN',
    body: 'Your client builds a Hiero TransferTransaction for exactly that amount, signs it, and retries the same request with the proof attached.',
  },
  {
    code: 'RUN',
    body: 'The facilitator verifies the payment, the service runs the inference, and settlement happens on Hedera as the response goes out.',
  },
  {
    code: 'RECEIPT',
    body: 'The answer comes back 200, with the settled transaction id in the PAYMENT-RESPONSE header. The response is the receipt.',
  },
];

export default async function AgentsPage() {
  const config = env();
  const base = config.X402_API_URL.replace(/\/+$/, '');
  const live = await loadDiscovery(base);

  const network = live?.network ?? config.X402_NETWORK;
  const facilitator = live?.facilitator ?? config.X402_FACILITATOR_URL;
  const payTo = live?.payTo ?? config.HEDERA_SERVICE_ACCOUNT_ID;

  const priced: Tier[] = live
    ? live.resources.map((resource) => ({
        id: resource.id,
        // Discovery publishes absolute URLs; the table wants the path, which
        // is also what survives the service moving to another host.
        path: new URL(resource.url).pathname,
        maxOutputTokens: resource.maxOutputTokens,
        tinybars: BigInt(resource.price.amount),
        blurb: TIER_BLURBS[resource.id] ?? '',
      }))
    : fallbackTiers(config.X402_PRICE_HBAR_TINYBARS);
  const small = priced[0]!;

  const FACTS = [
    { label: 'Base URL', value: base },
    { label: 'Network', value: network },
    { label: 'Asset', value: `HBAR · ${HBAR_ASSET}` },
    // Unset on a deployment that has not been given a service account. Saying
    // so is better than printing a placeholder id an agent would try to pay.
    { label: 'Pay to', value: payTo ?? 'not configured' },
  ];

  return (
    <Shell>
      {/*
       * No atmosphere and no quilt. The full-bleed sky is the landing page's
       * one moment, and a reference page that opens with weather asks the
       * reader to scroll past it every time they come back for the request
       * shape. This page opens on its own first line instead.
       */}
      <Section className="pt-20 md:pt-24">
        <div className="rise">
          <Eyebrow>For machines</Eyebrow>

          <h1 className="mt-8 max-w-4xl text-balance">
            <span className="display-serif text-almost-white block text-[clamp(2.5rem,8vw,5.5rem)]">
              Pay per call.
            </span>
            <span className="text-lavender-mist mt-3 block text-[clamp(1.5rem,4.4vw,3rem)] leading-[1.05] font-light tracking-[-0.04em]">
              No account, no key, no human.
            </span>
          </h1>

          <p className="text-steel mt-9 max-w-2xl text-[19px] leading-relaxed font-light text-pretty">
            The same inference a developer reaches in their editor, sold to software by the
            request. An agent discovers the service, reads the price, pays in HBAR and gets its
            answer — in about a second, with nobody having provisioned anything first.
          </p>
        </div>

        {/*
         * The four constants an integrator copies before anything else, in the
         * seamless hairline grid so they read as one instrument panel rather
         * than four cards. Every value comes from this deployment's own
         * environment, so the page cannot describe a service that is not the
         * one running.
         */}
        <dl className="frame mt-14 sm:grid-cols-2">
          {FACTS.map((fact) => (
            <div key={fact.label} className="p-6">
              <dt className="stamp-sm">{fact.label}</dt>
              <dd className="text-almost-white mt-3 font-mono text-[13px] break-all">
                {fact.value}
              </dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section>
        <Stamp
          size="section"
          sub="Three things, none of which involve us. There is no signup on this page because there is nothing to sign up to."
        >
          Before you start
        </Stamp>

        <div className="mt-12">
          {REQUIREMENTS.map((item) => (
            <div
              key={item.index}
              className="border-hairline grid gap-x-10 gap-y-3 border-t py-8 last:border-b md:grid-cols-[auto_1fr] md:items-baseline"
            >
              <span className="stamp-sm md:pt-1.5">{item.index}</span>
              <span className="min-w-0">
                <span className="text-almost-white block text-[22px] leading-tight font-light tracking-[-0.02em]">
                  {item.title}
                </span>
                <span className="text-steel mt-2.5 block max-w-2xl text-[15px] leading-relaxed text-pretty">
                  {item.body}
                </span>
              </span>
            </div>
          ))}
        </div>
      </Section>

      <Section>
        <Stamp
          size="section"
          sub="Discovery is free, and that is the point: an agent can read the terms and decide before it commits to anything. This document is the authority on price — the table further down is what it said when this page was built."
        >
          Read the terms
        </Stamp>

        <div className="mt-12 grid items-start gap-10 lg:grid-cols-2">
          <CodeBlock label="shell" code={`curl ${base}/.well-known/x402`} />
          <CodeBlock
            label="response"
            code={`{
  "x402Version": 2,
  "service": "GRAPE AI — inference",
  "network": "${network}",
  "payTo": "${payTo ?? '0.0.xxxxx'}",
  "facilitator": "${facilitator}",
  "resources": [
    {
      "id": "small",
      "method": "POST",
      "url": "${base}${small.path}",
      "maxOutputTokens": ${small.maxOutputTokens},
      "price": {
        "scheme": "exact",
        "asset": "${HBAR_ASSET}",
        "assetName": "HBAR",
        "amount": "${small.tinybars}",
        "amountHbar": "${toHbar(small.tinybars)}"
      }
    }
  ]
}`}
          />
        </div>

        <p className="text-steel mt-8 max-w-2xl text-[15px] leading-relaxed">
          <Code>GET /v1/pricing</Code> returns the same resource list on its own, and{' '}
          <Code>GET /health</Code> answers without charging. All three are registered before the
          paywall, so none of them costs anything.
        </p>
      </Section>

      <Section>
        <Stamp
          size="section"
          sub="wrapFetchWithPayment handles the whole handshake invisibly. Your code makes one call and gets one answer; the 402, the signing and the retry happen inside it."
        >
          Pay and call
        </Stamp>

        <div className="mt-12 space-y-8">
          <CodeBlock label="install" code="npm install @x402/core @x402/fetch @x402/hedera" />

          <CodeBlock
            label="agent.ts"
            code={`import { x402Client } from '@x402/core/client';
import { wrapFetchWithPayment } from '@x402/fetch';
import { PrivateKey, createClientHederaSigner } from '@x402/hedera';
import { ExactHederaScheme } from '@x402/hedera/exact/client';

const signer = createClientHederaSigner(
  process.env.HEDERA_ACCOUNT_ID!,
  PrivateKey.fromStringECDSA(process.env.HEDERA_PRIVATE_KEY!),
  { network: '${network}' },
);

const client = x402Client.fromConfig({
  schemes: [{ network: '${network}', client: new ExactHederaScheme(signer) }],
  // HBAR is not one of x402's default assets, so it has to be named before
  // the client will spend it. Name it with a ceiling: this is your budget
  // per call, and no server can quote its way past it.
  spendControls: {
    allowedAssets: [
      { network: '${network}', asset: '${HBAR_ASSET}', maxAmountPerPayment: '5000000' },
    ],
  },
});

const pay = wrapFetchWithPayment(fetch, client);

const response = await pay('${base}${small.path}', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    messages: [{ role: 'user', content: 'why is my gas so high?' }],
  }),
});

const answer = await response.json();
console.log(answer.text);

// The transaction id only exists once settlement has happened, which is
// after the body was generated — so it travels in a header, not the JSON.
const receipt = response.headers.get('PAYMENT-RESPONSE');`}
          />
        </div>

        <p className="text-steel mt-8 max-w-2xl text-[15px] leading-relaxed">
          Keys are read from the environment here for the same reason they are everywhere else. An
          agent that pays for its own inference is an agent holding a spending key, and{' '}
          <Code>maxAmountPerPayment</Code> is the only thing standing between a bad quote and your
          balance. Set it deliberately.
        </p>
      </Section>

      <Section>
        <Stamp
          size="section"
          sub="A flat per-request fee would charge the same for a fifty-token answer and a four-thousand-token one, which is the thing metered billing exists to avoid. The output ceiling is what is being sold, so it is what the price scales with."
        >
          What it costs
        </Stamp>

        {/*
         * The page's one violet surface, spent on the number that makes the
         * argument — the same way the landing page spends its bloom on the
         * revenue share. Type on it is near-black rather than the white the
         * source specifies: white on #af50ff measures 3.64:1, which is fine
         * for a button label and not fine for a line of body copy.
         */}
        <div className="bloom rounded-card text-near-black mt-12 grid gap-10 p-10 md:grid-cols-[1fr_auto] md:items-end md:p-14">
          <div>
            <div className="stamp-sm text-near-black/60">Starting price · per call</div>
            <p className="mt-6 max-w-xl text-[clamp(1.5rem,3.4vw,2.25rem)] leading-[1.1] font-light tracking-[-0.03em] text-balance">
              One request, one payment, one answer.
            </p>
            <p className="text-near-black/70 mt-5 max-w-lg text-[15px] leading-relaxed">
              No minimum, no commitment and no balance to top up. An agent that makes one call in
              its life pays for one call.
            </p>
          </div>
          <div className="flex items-baseline gap-3 text-[clamp(3rem,9vw,5.5rem)] leading-none font-light tracking-[-0.06em] tabular-nums">
            {toHbar(small.tinybars)}
            <span className="text-[0.3em] tracking-[0.1em] uppercase">HBAR</span>
          </div>
        </div>

        <div className="frame mt-10">
          <div className="hidden gap-6 px-6 py-4 md:grid md:grid-cols-[1fr_auto_auto]">
            <span className="stamp-sm">Route</span>
            <span className="stamp-sm text-right">Output ceiling</span>
            <span className="stamp-sm w-32 text-right">Price</span>
          </div>
          {priced.map((tier) => (
            <div
              key={tier.id}
              className="grid gap-x-6 gap-y-3 px-6 py-6 md:grid-cols-[1fr_auto_auto] md:items-baseline"
            >
              <span className="min-w-0">
                <span className="text-almost-white block font-mono text-[13px] break-all">
                  POST {tier.path}
                </span>
                <span className="text-steel mt-2 block max-w-md text-[14px] leading-relaxed">
                  {tier.blurb}
                </span>
              </span>
              <span className="text-steel text-[14px] tabular-nums md:text-right">
                ≤ {tier.maxOutputTokens.toLocaleString()} tokens
              </span>
              <span className="text-almost-white text-[15px] tabular-nums md:w-32 md:text-right">
                {toHbar(tier.tinybars)} HBAR
              </span>
            </div>
          ))}
        </div>

        <p className="text-steel mt-8 max-w-2xl text-[15px] leading-relaxed">
          The ceiling is enforced on the upstream call, not taken on trust. A{' '}
          <Code>maxTokens</Code> in your request body can only lower it — asking for 4,096 on the
          small route gets you 512, because the tier is what was priced.
        </p>
      </Section>

      <Section>
        <Stamp
          size="section"
          sub="What your client is doing while it looks like one fetch. Worth reading once, so the header names mean something when you need to debug them."
        >
          The handshake
        </Stamp>

        <ol className="mt-12">
          {HANDSHAKE.map((leg) => (
            <li
              key={leg.code}
              className="border-hairline grid gap-x-10 gap-y-3 border-t py-7 last:border-b md:grid-cols-[110px_1fr] md:items-baseline"
            >
              <span className="stamp-sm text-lavender-mist md:pt-1">{leg.code}</span>
              <span className="text-steel max-w-2xl text-[15px] leading-relaxed text-pretty">
                {leg.body}
              </span>
            </li>
          ))}
        </ol>
      </Section>

      <Section>
        <Stamp size="section" sub="Everything a paid route accepts and returns.">
          Reference
        </Stamp>

        <div className="mt-12 grid items-start gap-10 lg:grid-cols-2">
          <CodeBlock
            label="request body"
            code={`{
  // Required. At least one message.
  "messages": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ],

  // Optional. An unknown id falls back to the
  // default rather than erroring.
  "model": "...",

  // Optional. Clamped down to the tier ceiling,
  // never up.
  "maxTokens": 256
}`}
          />

          <CodeBlock
            label="200 response"
            code={`{
  "text": "...",
  "usage": {
    "inputTokens": 24,
    "outputTokens": 188,
    "totalTokens": 212
  },
  "requestId": "8f3c...",
  "model": "...",
  "tier": "${small.id}",
  "payment": {
    "network": "${network}",
    "asset": "${HBAR_ASSET}",
    "amount": "${small.tinybars}",
    "amountHbar": "${toHbar(small.tinybars)}"
  }
}`}
          />
        </div>

        <div className="frame mt-10">
          {[
            {
              name: 'PAYMENT-REQUIRED',
              dir: 'response · 402',
              body: 'The terms. Scheme, network, asset, amount, payTo and extra.feePayer, encoded. Your client reads this and builds the transfer from it.',
            },
            {
              name: 'PAYMENT-SIGNATURE',
              dir: 'request · retry',
              body: 'The signed transfer, attached to the second attempt. wrapFetchWithPayment sets it for you.',
            },
            {
              name: 'PAYMENT-RESPONSE',
              dir: 'response · 200',
              body: 'The receipt: payer, amount and the settled Hedera transaction id. Decode it with decodePaymentResponseHeader from @x402/core/http.',
            },
          ].map((header) => (
            <div
              key={header.name}
              className="grid gap-x-8 gap-y-2.5 px-6 py-6 md:grid-cols-[auto_1fr] md:items-baseline"
            >
              <span className="min-w-0 md:w-56">
                <span className="text-almost-white block font-mono text-[13px] break-all">
                  {header.name}
                </span>
                <span className="stamp-sm mt-2 block">{header.dir}</span>
              </span>
              <span className="text-steel max-w-2xl text-[15px] leading-relaxed text-pretty">
                {header.body}
              </span>
            </div>
          ))}
        </div>

        <p className="text-steel mt-8 max-w-3xl text-[15px] leading-relaxed">
          A malformed body is <Code>400</Code> before any payment is taken. Settlement is the
          chain&rsquo;s business, not ours: once the transfer is on Hedera the purchase is
          complete, so our own bookkeeping is best-effort and a database we cannot write to will
          never turn a paid answer into a <Code>500</Code> you would retry and pay for twice.
        </p>
      </Section>

      <Section divide className="flex flex-wrap items-center justify-between gap-8">
        <p className="display-serif text-almost-white max-w-xl text-[clamp(1.75rem,4.4vw,3rem)] text-balance">
          Or come in the other door and let ads pay for it.
        </p>
        <Button size="lg" variant="outline" nativeButton={false} render={<Link href="/app" />}>
          For developers
        </Button>
      </Section>
    </Shell>
  );
}
