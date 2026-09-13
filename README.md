# GRAPE AI

**Ads that pay for your AI.**

A Cursor-style AI coding assistant in VS Code, denominated in credits, where relevant
sponsored content subsidises inference instead of interrupting it.

1. A developer buys credits, or gets a starter grant on signup.
2. Credits pay for AI inference, priced per token.
3. Between responses, a relevant sponsored card appears, clearly separated from the answer.
4. The advertiser funds a campaign; qualified attention pays the developer their share.
5. That share starts at 70% and climbs to 85% across three earning tiers — Bud, Vine,
   Reserve — out of the platform's cut, never off the advertiser's bill.
6. Those earnings are credits, which buy more inference.

The loop closes because usage is what creates the inventory. A developer asking how to
deploy a Solidity contract is worth more to an Ethereum infrastructure advertiser than any
demographic segment, and that value exists only at the moment they ask. At current settings
**roughly one relevant sponsored card funds one AI response**.

A third actor pays for the same gateway: autonomous agents, per call, over x402 on Hedera.

Built for [ETHOnline 2026](https://ethglobal.com/events/ethonline2026).
Full model and worked numbers: [`docs/economics.md`](docs/economics.md).

## Why it is not "ChatGPT with ads"

- The ad is a separate event on the response stream. The model is never asked to mention a
  sponsor, and the client cannot render sponsored content as if the assistant wrote it.
- Advertisers never receive prompts, code, conversations, wallet addresses or identities.
  They target a closed vocabulary of derived signals, defined in
  [`packages/shared/src/taxonomy.ts`](packages/shared/src/taxonomy.ts). There is no database
  column anywhere that can hold a prompt.
- An irrelevant ad is worse than no ad, so the auction has a relevance floor and returns
  nothing when no campaign clears it.

## Status

Foundation is in place and tested. Product surfaces are not built yet.

| Area | State |
|---|---|
| Monorepo, tooling, environment | Done |
| Database schema + initial migration (23 tables) | Done, not yet run against a database |
| Auction, rewards, token accounting | Done, 44 tests |
| AI provider abstraction (Bedrock + fake) | Done, 4 tests |
| Intent engine (rules + LLM stages) | Done, 19 tests |
| Wallet sign-in (SIWE), sessions, VS Code handoff | Done, 6 tests |
| Credit ledger | Done, untested against a database |
| AI gateway with streaming, ads and billing | Done, untested against a database |
| Ad selection against live campaigns | Done, verified against the database |
| Reward granting on confirmed impressions | Done, untested against a database |
| Advertiser onboarding and campaign lifecycle | Done, 11 tests |
| The Graph audience service | Done, 15 tests, needs a gateway key to run live |
| Wallet linking with signature proof | Done, 6 tests |
| Smart contracts | Done, 21 Foundry tests, **deployed to Hedera testnet** and exercised end to end |
| VS Code extension | Chat, markdown answers, sponsored card, dwell ack, reward and cost readout |
| Abuse rules (dwell, duplicates, caps, velocity) | Done, untested against a database |
| API routes (31) | Done, build and 401/CORS verified |
| Web dashboards | Scaffolded only |
| x402 paid-inference service + agent CLI | Done, 10 tests, **verified on Hedera testnet** |

The core loop is verified end to end against a real Postgres: advertiser budget becomes a
relevant ad, confirmed attention becomes credits, and those credits pay for the next
request. See `apps/web/src/server/loop.integration.test.ts`.

Full architecture and the phased build order:
[`docs/implementation-plan.md`](docs/implementation-plan.md).

## Layout

```
apps/web              Next.js 16 app — UI and the /api/v1 backend
  src/server          framework-free backend modules (config, intent, ...)
apps/x402-api         Express service selling inference to agents, paid in HBAR
apps/agent-demo       CLI agent that discovers, pays and consumes it
packages/shared       taxonomy, wire contracts, micro-USD money helpers
packages/db           Prisma 7 schema and client
packages/economics    the auction, reward split and token spend planner (pure)
packages/ai-provider  AIProvider interface, Bedrock implementation, fake for tests
docs/                 implementation plan
```

`packages/economics` is deliberately IO-free so the rules that decide who gets paid can be
tested directly, and `packages/ai-provider` ships a `FakeProvider` so the whole request
lifecycle can be exercised without AWS credentials, network or spend.

## Running it

Requires Node 22+ and pnpm 10.

```bash
pnpm install
cp .env.example .env      # works with placeholders; see "Keys" below
pnpm db:generate
pnpm test                 # 103 tests, no keys, no network, no Docker
```

The integration tests run against a real Postgres without needing one installed: PGlite is
an embedded Postgres that speaks the wire protocol over a socket, so Prisma's ordinary
driver connects to it unchanged and the tests exercise the same SQL, transactions and
triggers that production runs.

### The whole stack, locally

No Docker, no Supabase, no network. PGlite is an embedded Postgres that speaks the wire
protocol over a socket, so Prisma's ordinary driver connects to it unchanged and gets the
same SQL, transactions and triggers as production.

```bash
pnpm db:dev               # 127.0.0.1:55432, persisted in ./.pglite
```

Then, in a second terminal, with `.env` pointing `DATABASE_URL` and `DIRECT_URL` at
`postgresql://postgres:postgres@127.0.0.1:55432/postgres` and `PRISMA_POOL_MAX=1`:

```bash
pnpm --filter @aam/db db:deploy   # migrations
pnpm --filter @aam/db db:harden   # append-only ledger trigger
pnpm dev
```

`PRISMA_POOL_MAX=1` is required: PGlite serves one connection at a time, and the default
pool opens several and has them dropped underneath it.

Sign in from the header with a wallet. There is no demo data: an advertiser account and
its campaigns are created through the UI, and a new user's starter grant is issued on
first sign-in. (**Dev sign-in** still exists for accounts whose subject begins `seed:`,
but nothing creates those any more, so the menu is empty.)

Docker gives you real Postgres 16 and a `psql` prompt instead, if you want one:

```bash
docker compose up -d
export DIRECT_URL="postgresql://postgres:postgres@127.0.0.1:5432/aam"
export DATABASE_URL="$DIRECT_URL"
pnpm --filter @aam/db db:deploy
```

The migrations are verified against both PostgreSQL 16.15 and PGlite.

A database that the old seed already ran against still holds its rows. To clear them —
the four `[simulated]` advertisers with their campaigns and creatives, the three
`[simulated]` users, and the plan rows — leaving every real account and its ledger
untouched:

```bash
pnpm --filter @aam/db db:purge-demo            # report what would go
pnpm --filter @aam/db db:purge-demo --commit   # delete it
```

Typecheck everything:

```bash
pnpm --filter @aam/web typecheck
```

## Keys

Nothing above needs credentials. These are needed as their features get built, and all of
them stay server-side — the extension and the browser receive none of them:

| Key | Needed for |
|---|---|
| Supabase `DATABASE_URL` + `DIRECT_URL` | any persistence |
| AWS credentials + Bedrock access | real inference (`AI_PROVIDER=fake` avoids this) |
| Subgraph Studio key + Token API JWT | onchain audience signals |
| Hedera testnet accounts | the x402 paid-inference demo |
| A funded Hedera deployer ([portal](https://portal.hedera.com)) | deploying the vault and reward pool — not needed for anything that runs today |

## Paying with x402 on Hedera

The third actor is a machine. It has no account here, no credits and no API key, so the
ad-funded path is closed to it — and asking an autonomous agent to sign up, hold a balance
and rotate a key is asking it to be a person. Instead it pays for each call, in HBAR, at
the moment it calls, and the HTTP response *is* the receipt.

Settled through the [Blocky402](https://blocky402.com) facilitator on Hedera testnet.

### The flow

```
agent                    x402-api                Blocky402          Hedera
  │  POST /v1/inference      │                       │                 │
  │─────────────────────────>│                       │                 │
  │  402 + payment terms     │                       │                 │
  │<─────────────────────────│                       │                 │
  │  sign TransferTransaction│                       │                 │
  │  retry w/ PAYMENT-SIGNATURE                      │                 │
  │─────────────────────────>│──── verify ──────────>│                 │
  │                          │<─── ok ───────────────│                 │
  │                          │ Bedrock inference     │                 │
  │                          │──── settle ──────────>│──> transfer ───>│
  │  200 + answer            │<─── receipt ──────────│<────────────────│
  │  + PAYMENT-RESPONSE      │                       │                 │
  │<─────────────────────────│                       │                 │
```

Three details worth pulling out:

- **Discovery is free.** `GET /.well-known/x402` and `/v1/pricing` cost nothing, so an
  agent can read the terms and decide before it commits to anything.
- **Settlement happens after the handler runs**, which is why the transaction id arrives in
  the `PAYMENT-RESPONSE` header rather than the JSON body — it does not exist yet when the
  body is generated.
- **The agent never pays gas.** The facilitator signs as fee payer, announced as
  `extra.feePayer` in the 402, so an agent needs HBAR only for the price itself.

### Priced by what is actually sold

| Route | Price | Output ceiling |
|---|---|---|
| `POST /v1/inference` | 0.01 HBAR | 512 tokens |
| `POST /v1/inference/large` | 0.05 HBAR | 4096 tokens |

A flat per-request fee would charge the same for a 50-token answer and a 4,000-token one,
which is the thing metered billing exists to avoid. The ceiling is what is being sold, so
it is what the price scales with — and it is clamped server-side, so a client cannot ask
for 4,000 tokens on the small route and be served them at the small price.

The agent carries the matching control on its own side: a per-call spend cap
(`X402_AGENT_MAX_TINYBARS`) that no server can talk it out of, whatever the 402 quotes.

### Running it

Two ECDSA testnet accounts from [portal.hedera.com](https://portal.hedera.com) — one to
receive payment, one to spend — in `HEDERA_SERVICE_ACCOUNT_ID` and
`HEDERA_AGENT_ACCOUNT_ID` with their keys. Both arrive funded.

```bash
pnpm --filter @aam/x402-api start                          # terminal 1
pnpm --filter @aam/agent-demo start "why is my gas so high?"
pnpm --filter @aam/agent-demo start --large "explain EVM gas metering in detail"
```

The agent prints every step — discovery, the 402, the payment, the answer, and a HashScan
link to the settled transaction.

A real run, with the on-chain balance changes and the decoded 402:
[`docs/evidence/x402-run.md`](docs/evidence/x402-run.md).

Each paid call writes a `payments` row and an `ai_usage` row with `funding_source: x402`,
so machine revenue lands in the same ledger as everything else while touching no credit
balance — it was paid in HBAR, not in credits. Those writes are best-effort by design: the
payment has already settled on Hedera by the time they run, so a database that is down must
not turn a completed purchase into a 500 the agent retries and pays for twice. The chain is
the ledger of record; the rows are a local index of it.

## Onchain settlement

`CampaignVault` and `RewardPool` are deployed to **Hedera testnet (296)** — the
same chain the x402 payments settle on, so the project has one chain rather than
two.

| Contract | Hedera id | EVM address |
|---|---|---|
| CampaignVault | [`0.0.10502346`](https://hashscan.io/testnet/contract/0.0.10502346) | `0x4F160b39EbB23DBA8650f50aD5fc95964e085c42` |
| RewardPool | [`0.0.10502343`](https://hashscan.io/testnet/contract/0.0.10502343) | `0x1E0724300F61bbF03caFB9D0fE52A039108B784B` |

The token is HTS USDC [`0.0.5449`](https://hashscan.io/testnet/token/0.0.5449),
which the EVM reaches at `0x…1549` with 6 decimals, matching the ledger's
micro-USD precision exactly — so a USDC base unit and a credit micro are the
same number, with no conversion step to get wrong. Real testnet USDC comes from
[Circle's faucet](https://faucet.circle.com) with Hedera Testnet selected;
there is no mock token in the deployable path.

The whole loop has run on chain: 100 USDC funded into a campaign, settled
70 / 20 / 10, and withdrawn from the pool — including a replayed withdrawal the
contract refused. Every transaction, with balance changes:
[`docs/evidence/onchain.md`](docs/evidence/onchain.md).

High-volume events never touch either contract. An impression, and an individual
reward worth a few thousandths of a cent, would cost more in gas than the reward
is worth and would publish exactly the behavioural trail the product promises not
to expose; both contracts see only funding and aggregate settlement. See
[`contracts/README.md`](contracts/README.md), which also covers the HTS
association caveat that has no equivalent on other EVM chains.

## Money

All amounts are integer **micro-USD** (`1_000_000` = `$1.00`). No floats touch the ledger.
The credit ledger is append-only and enforced by a database trigger, because one stray
update would silently break the balance chain that the entire reward economy rests on.

## Economics

Credits are the only currency. They enter by purchase, ad reward or starter grant, and
leave by paying for inference or being withdrawn. Every number that decides a payout lives
in [`apps/web/src/server/config/economics.json`](apps/web/src/server/config/economics.json),
never in business logic. Campaigns snapshot the allocation split when they activate, so
editing that file never rewrites the economics of a campaign that is already running.

Rewards are gated on evidence, not on an ad being shown: confirmed on-screen time,
duplicate-prompt rejection, minimum spacing, frequency caps and a daily ceiling. A user can
never be paid more than an advertiser was charged. See [`docs/economics.md`](docs/economics.md).

## Licence

MIT
