# AI Attention Marketplace

**Ads that pay for your AI.**

An AI coding assistant for developers, delivered through a VS Code extension, where
relevant sponsored content subsidises inference instead of interrupting it. Advertisers
buy high-intent developer attention. Users earn AI credits from qualified ad activity and
spend them on more inference. AI agents pay for the same inference per call over x402.

Built for [ETHOnline 2026](https://ethglobal.com/events/ethonline2026).

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
| Database schema (23 models) | Done, not yet migrated to a live database |
| Auction, rewards, token accounting | Done, 48 tests |
| AI provider abstraction (Bedrock + fake) | Done, 4 tests |
| Intent engine, rules stage | Done, 19 tests |
| Intent engine, LLM stage | Not started |
| API routes, auth, credits, ads, rewards | Not started |
| The Graph audience service | Not started |
| Web dashboards | Scaffolded only |
| VS Code extension | Not started |
| x402 service and agent demo | Not started |
| Contracts | Not started |

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
pnpm test                 # 71 tests, no keys or network needed
```

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

Every number that decides a payout lives in
[`apps/web/src/server/config/economics.json`](apps/web/src/server/config/economics.json),
never in business logic. Campaigns snapshot the allocation split when they activate, so
editing that file never rewrites the economics of a campaign that is already running.

## Licence

MIT
