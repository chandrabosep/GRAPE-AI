# GRAPE AI: ETHOnline 2026 submission

Copy-paste source for the ETHGlobal submission form. Sections map to the form fields.

---

## Short description (tagline)

Ads that pay for your AI. A VS Code assistant where relevant sponsored content funds your
inference, targeted on real onchain history from The Graph and settled on Hedera.

---

## Project description

Developers spend billions on AI. Brands spend billions trying to reach those same
developers. The two economies never touch. GRAPE AI connects them.

**Developers stopped browsing.** The Stack Overflow tab, the docs site, the dev blog, the
newsletter, all of it collapsed into one chat window. A developer now spends the working day
inside their editor asking an AI, which means the entire display advertising industry is
buying impressions on pages their audience no longer opens. That is the gap GRAPE AI closes:
it puts the brand where the developer actually is, at the exact moment they are choosing a
tool. A developer asking how to deploy a Solidity contract is worth more to an infrastructure
company than any demographic segment, and that value exists only in the second they ask it.

You code in your editor and ask the assistant a question. You get a streaming answer, and
one relevant sponsored card sits beside it, never inside it. The brand pays for that
attention, most of what they pay lands in your balance as credits, and those credits buy
your next answer. Build more, earn more, pay less. At current settings roughly one card
funds one response.

Three parties pay for the same gateway:

- **Developers** get a starter grant on signup, spend credits per token, and earn them back
  from attention. Their share starts at 70% and climbs to 85% across three tiers, taken out
  of the platform's cut rather than off the advertiser's bill, so a campaign costs the same
  whoever sees it.
- **Advertisers** fund a campaign in HTS USDC on Hedera and target real onchain behaviour
  rather than demographics. They are billed only for attention that cleared the evidence
  rules, and a user can never be paid more than the advertiser was charged.
- **Autonomous agents** pay per call in HBAR over x402. No signup, no balance, no API key.

The extension is live on the VS Code Marketplace and Open VSX and took **over 350 organic
downloads in its first 24 hours**. This is real inventory, not a slide.

**Try it:** https://marketplace.visualstudio.com/items?itemName=GrapeTools.grape-ai

---

## How it is made

### The Graph: two jobs, both load-bearing

**Targeting.** The moment a developer links a wallet, GRAPE AI pulls their onchain profile
and turns it into a persona: active trader, DeFi power user, NFT holder, smart contract
developer. An advertiser then builds a campaign against role, region and live onchain
behaviour, for example developers actively supplying to lending protocols or trading on
DEXs, inside a chosen window and on chosen chains. There are three onchain modes: `off`
ignores it, `boost` scores matched users higher, `require` makes every criterion mandatory.
Flipping that switch visibly changes which ad wins. Remove The Graph and the onchain term
is always zero and `require` campaigns are never eligible.

**Live data in the answer.** `query_blockchain` is a server-side tool the assistant can
call. Ask "show me the top 5 Uniswap V3 pools by TVL on mainnet and build a dark-themed HTML
chart" and it writes the GraphQL, reads the result, and builds the chart from live numbers.
Nine protocols across Ethereum, Arbitrum and Base, plus ENS and live token prices.

**Three Graph products composed**, each answering something the others cannot:

| Product | Question it answers |
|---|---|
| Subgraphs on the decentralized network | Did this wallet touch this protocol since T? |
| Token API (Pinax) | What does it hold, and has it moved recently? |
| Substreams (Pinax) | Block-level ERC-20 transfers, for active traders a balance snapshot misses |

All live data from Graph providers. Nothing mocked, cached from a fixture, or local.

**The standardization leverage.** The subgraph layer is a registry of 13 deployments across
9 protocols and 3 chains, and adding a protocol to targeting is **one config entry, not new
code**. The Messari standardized schemas mean one query shape spans every deployment in a
schema generation: the lending query runs unchanged against Aave V2, Aave V3 on two chains,
and Compound V3. Four protocols, one query, zero per-protocol branches.

Two things about this are easy to get wrong and impossible to notice in production, so both
have tests. The gateway returns HTTP 200 with a GraphQL error envelope for auth failures and
unknown subgraphs alike, so checking `response.ok` turns every failure into "this wallet has
no history", which is indistinguishable from a real answer. And two incompatible DEX schema
generations are deployed simultaneously: 4.0.1 has `Swap.account` as a relation, 1.3.2 only
a plain `from` string. Both are normalised before anything downstream sees them.

### Hedera: two assets, two jobs

**HBAR is the machine payment rail.** A live x402-gated inference service settles through
the Blocky402 testnet facilitator. The agent hits the endpoint, gets a 402 with payment
terms, signs a `TransferTransaction`, retries, and the HTTP response is the receipt.

Per-call pricing only works if moving the money is cheap and predictable relative to what is
being sold. At 0.01 HBAR a call that is a hard constraint, and it is why the rail is HBAR:

- Payment is a native `CRYPTOTRANSFER`, not an ERC-20 `transfer`. No approval, no allowance,
  no token contract in the path. One transaction, one signature.
- The fee is fixed in USD and does not move with congestion. On a gas-priced chain a fee
  spike can cost more than the item being sold, which destroys per-call pricing the first
  busy hour.
- Finality in about three seconds, so the agent waits once and gets its answer in the same
  request.
- The agent pays no gas at all. The facilitator signs as fee payer, announced as
  `extra.feePayer` in the 402. In our reference run the network fee was 268,834 tinybars and
  the facilitator paid every one.

Pricing is metered rather than flat, because the output ceiling is what is actually being
sold. `POST /v1/inference` is 1,000,000 tinybars (0.01 HBAR) for up to 512 output tokens;
`/v1/inference/large` is 5,000,000 tinybars (0.05 HBAR) for up to 4096. The ceiling is
clamped server-side, so a client cannot ask for 4,000 tokens on the small route and be
served them at the small price, and the large tier is derived from the base as `base * 5n`
so the two prices cannot drift apart. Everything on the wire is integer tinybars, never a
decimal, so no float touches a price. The agent enforces its own `X402_AGENT_MAX_TINYBARS`
cap before it signs, whatever the 402 quotes.

Discovery is free: `GET /.well-known/x402` and `/v1/pricing` cost nothing, so an agent reads
the terms and decides before committing. Settlement runs after the handler, which is why the
transaction id arrives in the `PAYMENT-RESPONSE` header rather than the body. It does not
exist yet when the body is generated.

**HTS USDC is the rail for money that sits still.** Advertiser budgets and developer
withdrawals use USDC `0.0.5449`, whose 6 decimals match the ledger's micro-USD precision
exactly, so a token base unit and a credit micro are the same number and no conversion step
exists anywhere to get wrong.

Two contracts, deployed and exercised end to end:

| Contract | Hedera id | EVM address |
|---|---|---|
| CampaignVault | `0.0.10502346` | `0x4F160b39EbB23DBA8650f50aD5fc95964e085c42` |
| RewardPool | `0.0.10502343` | `0x1E0724300F61bbF03caFB9D0fE52A039108B784B` |

They assume the operator key is compromised eventually. It picks settlement amounts but not
destinations: funds can only reach the reward pool, the platform wallet or the treasury, all
set by the owner. It can never settle more than a campaign has left unsettled. A payout id
can only be paid once. A fuzz test asserts that across arbitrary splits no value ever
reaches an arbitrary address. 21 Foundry tests.

The whole loop has run on chain: 100 USDC funded, settled 70 / 20 / 10, withdrawn from the
pool, and a replayed withdrawal the contract refused with `CONTRACT_REVERT_EXECUTED`.
Impressions and individual rewards never touch a contract, because a reward worth a few
thousandths of a cent would cost more in gas than it is worth and would publish exactly the
behavioural trail this product refuses to expose.

Topping up is a USDC transfer verified against the Hedera mirror node before anything is
credited, with a unique constraint on the transaction id as the replay guard, and a sweep
that finds unclaimed transfers so a closed browser tab loses nothing.

### The rest of the stack

A Next.js 16 app serves both the UI and a 35-route `/api/v1` backend. Intent runs in two
stages: a dependency-free rules pass in under a millisecond so the card can appear while the
model is still streaming, then a small fast model that reads the sentence, which is what
separates "fix this deployment script" from "deploy this contract". The auction scores
campaigns on intent, audience, onchain signals, bid, frequency and fraud, with every weight
in a config file rather than in business logic.

Inference runs on AWS Bedrock. The credit ledger is append-only, enforced by a database
trigger, in integer micro-USD with no floats. The economics package is IO-free so the rules
that decide who gets paid are tested directly, and the AI provider ships a fake so the full
request lifecycle runs with no credentials, network or spend.

257 tests pass: 100 in the web app including an end-to-end loop against real Postgres, 65
economics, 32 shared, 25 extension, 21 Foundry, 10 x402, 4 provider. The integration tests
run against real Postgres without needing one installed, using PGlite over the wire
protocol, so Prisma's ordinary driver connects unchanged.

### Hacky bit worth mentioning

The sponsored card is a sibling of the answer in the component tree, not a styling choice.
That is also why the extension is a custom webview rather than a VS Code Chat Participant:
the participant API can only emit markdown and cannot render a card that is visually
separate from the answer, and blending an ad into assistant text is the one thing this
product refuses to do.

---

## Prize tracks

### The Graph: Best Use of Composable or Standardized Graph Products

- **Composes three Graph products**: decentralized-network Subgraphs, the Token API, and
  Substreams, each answering a different question, merged into one audience profile with
  per-source provenance.
- **Builds on Messari Standardized Subgraphs**: 13 deployments, 9 protocols, 3 chains, one
  query shape per schema generation. Adding a protocol is a config entry.
- **Live data only**, through the Graph gateway with a Subgraph Studio key and Pinax.
- **The leverage is visible**: the lending query in `apps/web/src/server/modules/graph/queries.ts`
  runs unchanged against four protocols on three chains.

### The Graph: Best AI Tooling or AI Use Case (Start Fresh)

- The Graph is the assistant's live blockchain data source through the `query_blockchain`
  tool, reachable from VS Code, Cursor and Windsurf by hundreds of developers already.
- The data does real work: it drives ad selection, campaign eligibility and audience
  estimates, and answers developer questions with charts built from live numbers. It is not
  printing a raw query result.
- Agents pay per query autonomously over x402, which is the third leg of the track.

### Hedera: AI and Agentic Payments

- **A live x402-gated service on Hedera testnet**, settled through Blocky402:
  https://grape-ai-api.vercel.app/.well-known/x402
- **A platform and an agent that consume it.** The CLI agent completes real paid requests end
  to end, and the demo prints every step with a HashScan link.
- **Pay-per-call inference metered by output ceiling**, not a flat per-request charge.
- **HTS tokens in the settlement path**: HTS USDC for budgets, settlement and withdrawals.
- Verifiable audit trail: every payment is a mirror node record, and every paid call writes a
  `payments` row with `funding_source: x402` indexed against it.

---

## Links

| | |
|---|---|
| VS Code Marketplace | https://marketplace.visualstudio.com/items?itemName=GrapeTools.grape-ai |
| Open VSX (Cursor, Windsurf) | https://open-vsx.org/extension/GrapeTools/grape-ai |
| Web app | https://grape-ai-dev.vercel.app |
| Agent API discovery | https://grape-ai-api.vercel.app/.well-known/x402 |
| Agent docs | https://grape-ai-dev.vercel.app/agents |
| CampaignVault | https://hashscan.io/testnet/contract/0.0.10502346 |
| RewardPool | https://hashscan.io/testnet/contract/0.0.10502343 |
| HTS USDC | https://hashscan.io/testnet/token/0.0.5449 |
| A real x402 payment | https://hashscan.io/testnet/transaction/0.0.7162784@1789210503.635358513 |
| Campaign settled 70/20/10 | https://hashscan.io/testnet/transaction/0.0.7314364@1789221257.884494799 |
| Replayed withdrawal, refused | https://hashscan.io/testnet/transaction/0.0.7314364@1789221301.463657733 |

---

## Demo video beats

1. **The problem.** Developers pay for AI, brands pay for attention, the loop is broken.
2. **The advertiser.** Create a campaign, target a persona built from live onchain history
   via The Graph, write the card, fund it in USDC on Hedera. Show the analytics.
3. **The developer.** Ask a real question in VS Code. Answer streams, the card appears
   beside it, credits land. Then ask the Uniswap V3 TVL question and watch The Graph feed
   the chart.
4. **The agent.** Run the CLI. Discovery, 402, HBAR payment, answer, HashScan link. No
   account, no key.
5. **The proof.** HashScan: funding, the 70/20/10 settle, the withdrawal, the replay that
   was refused.
6. **The traction.** 350+ downloads in 24 hours, organic.
