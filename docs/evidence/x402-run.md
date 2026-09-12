# x402 paid request — Hedera testnet

One real, end-to-end paid inference request: an agent discovers the service,
receives a 402, signs a Hedera `TransferTransaction`, and gets its answer. No
API key, no account with us, no subscription.

Settled through the **Blocky402 testnet facilitator**
(`https://api.testnet.blocky402.com`).

## The transaction

**[hashscan.io/testnet/transaction/0.0.7162784@1789210503.635358513](https://hashscan.io/testnet/transaction/0.0.7162784@1789210503.635358513)**

| | |
|---|---|
| Result | `SUCCESS` (`CRYPTOTRANSFER`) |
| Consensus | `1789210509.339215209` |
| Network | `hedera:testnet` |
| Asset | HBAR (`0.0.0`) |
| Amount | 1,000,000 tinybars = 0.01 HBAR |
| Tier | `small` (≤512 output tokens) |
| Request id | `239f1006-5820-4a3b-859f-b75abbe98596` |
| Tokens | 15 in / 74 out |

Balance changes, from the mirror node:

| Account | Δ tinybars | Role |
|---|---:|---|
| `0.0.10498983` | −1,000,000 | agent, the payer |
| `0.0.10498528` | +1,000,000 | service, `payTo` |
| `0.0.7162784` | −268,834 | Blocky402, the fee payer |
| `0.0.802` | +268,834 | network fee |

Note the third row: **the agent never pays gas.** The facilitator signs as fee
payer, which is what `extra.feePayer` in the 402 announces, so an agent needs
HBAR only for the price itself.

## Reproducing it

```bash
pnpm --filter @aam/x402-api start          # terminal 1
pnpm --filter @aam/agent-demo start "Summarize this Solidity error: Stack too deep"
```

Verify any run against the mirror node directly — substitute the transaction id,
replacing `@` and the final `.` with `-`:

```bash
curl -s https://testnet.mirrornode.hedera.com/api/v1/transactions/0.0.7162784-1789210503-635358513
```

## The 402, decoded

```json
{
  "scheme": "exact",
  "network": "hedera:testnet",
  "amount": "1000000",
  "asset": "0.0.0",
  "payTo": "0.0.10498528",
  "maxTimeoutSeconds": 300,
  "extra": { "feePayer": "0.0.7162784" }
}
```

## Metered, not flat

Two priced tiers rather than one per-request fee, because the output ceiling is
what is actually being sold:

| Route | Price | Output cap |
|---|---|---|
| `POST /v1/inference` | 0.01 HBAR | 512 tokens |
| `POST /v1/inference/large` | 0.05 HBAR | 4096 tokens |

The cap is clamped server-side, so a client cannot request 4,000 tokens on the
small route and be served them at the small price.

The agent carries the matching control on its own side: a per-call spend cap
(`X402_AGENT_MAX_TINYBARS`, default 5,000,000) that a server cannot talk it out
of, whatever price the 402 quotes.
