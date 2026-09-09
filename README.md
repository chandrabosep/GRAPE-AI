# AI Attention Marketplace

**Ads that pay for your AI.**

A Cursor-style AI coding assistant in VS Code, denominated in credits, where relevant
sponsored content subsidises inference instead of interrupting it.

1. A developer buys credits, or gets a starter grant on signup.
2. Credits pay for AI inference, priced per token.
3. Between responses, a relevant sponsored card appears, clearly separated from the answer.
4. The advertiser funds a campaign; qualified attention pays the developer their share.
5. Those earnings are credits, which buy more inference.

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
| Auth, sessions, VS Code handoff | Done, untested against a database |
| Credit ledger | Done, untested against a database |
| AI gateway with streaming, ads and billing | Done, untested against a database |
| Ad selection against live campaigns | Done, untested against a database |
| Reward granting on confirmed impressions | Done, untested against a database |
| Abuse rules (dwell, duplicates, caps, velocity) | Done, untested against a database |
| API routes (13) | Done, build and 401/CORS verified |
| The Graph audience service | Not started |
| Web dashboards | Scaffolded only |
| VS Code extension | Not started |
| x402 service and agent demo | Not started |
| Contracts | Not started |

The core loop is verified end to end against a real Postgres: advertiser budget becomes a
relevant ad, confirmed attention becomes credits, and those credits pay for the next
request. See `apps/web/src/server/loop.integration.test.ts`.

Full architecture and the phased build order:
[`docs/implementation-plan.md`](docs/implementation-plan.md).

## Layout

```
apps/web              Next.js 16 app — UI and the /api/v1 backend
  src/server          framework-free backend modules (config, intent, ...)
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
pnpm test                 # 77 tests, no keys, no network, no Docker
```

The integration tests run against a real Postgres without needing one installed: PGlite is
an embedded Postgres that speaks the wire protocol over a socket, so Prisma's ordinary
driver connects to it unchanged and the tests exercise the same SQL, transactions and
triggers that production runs.

For a database you can poke at by hand, either works. Docker gives you real
Postgres 16 and a `psql` prompt:

```bash
docker compose up -d
export DIRECT_URL="postgresql://postgres:postgres@127.0.0.1:5432/aam"
export DATABASE_URL="$DIRECT_URL"
pnpm --filter @aam/db db:deploy
pnpm db:seed
```

Or skip Docker entirely with the same embedded Postgres the tests use:

```bash
pnpm db:dev               # 127.0.0.1:55432, in-memory
```

The migration and seed are verified against both PostgreSQL 16.15 and PGlite.

Typecheck everything:

```bash
pnpm --filter @aam/web typecheck
```

Once a Supabase database is configured in `.env`:

```bash
pnpm db:migrate
pnpm --filter @aam/db db:harden   # applies the append-only ledger trigger
pnpm dev
```

## Keys

Nothing above needs credentials. These are needed as their features get built, and all of
them stay server-side — the extension and the browser receive none of them:

| Key | Needed for |
|---|---|
| Supabase `DATABASE_URL` + `DIRECT_URL` | any persistence |
| AWS credentials + Bedrock access | real inference (`AI_PROVIDER=fake` avoids this) |
| Privy app id, secret, JWT verification key | login and embedded wallets |
| Subgraph Studio key + Token API JWT | onchain audience signals |
| Hedera testnet accounts | the x402 paid-inference demo |

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
