# On-chain evidence — Hedera testnet

Everything below was read back off the mirror node, not from our database. Every
link goes to HashScan; every figure is a balance change the network recorded.

Network: **Hedera testnet**, chain id `296`.
Explorer: `https://hashscan.io/testnet` · Mirror node: `https://testnet.mirrornode.hedera.com`

---

## The one-minute demo

Four links, in the order the story goes.

| # | What it proves | Link |
|---|---|---|
| 1 | An agent paid for inference with no account and no key | [0.01 HBAR, agent → service](https://hashscan.io/testnet/transaction/0.0.7162784@1789210503.635358513) |
| 2 | An advertiser's 100 USDC split 70 / 20 / 10 | [settle](https://hashscan.io/testnet/transaction/0.0.7314364@1789221257.884494799) |
| 3 | A user withdrew real USDC | [25 USDC out of the pool](https://hashscan.io/testnet/transaction/0.0.7314364@1789221291.733974890) |
| 4 | The same withdrawal, replayed, was refused by the contract | [CONTRACT_REVERT_EXECUTED](https://hashscan.io/testnet/transaction/0.0.7314364@1789221301.463657733) |

Row 4 is the one worth pausing on — see [Idempotency](#idempotency-proven-not-claimed).

---

## Contracts

| Contract | Hedera id | EVM address |
|---|---|---|
| CampaignVault | [`0.0.10502346`](https://hashscan.io/testnet/contract/0.0.10502346) | `0x4F160b39EbB23DBA8650f50aD5fc95964e085c42` |
| RewardPool | [`0.0.10502343`](https://hashscan.io/testnet/contract/0.0.10502343) | `0x1E0724300F61bbF03caFB9D0fE52A039108B784B` |

Deployments:
[RewardPool](https://hashscan.io/testnet/transaction/0.0.7314364@1789221170.876759689) ·
[CampaignVault](https://hashscan.io/testnet/transaction/0.0.7314364@1789221177.948357092)

## Accounts

| Account | Role | Holdings at time of writing |
|---|---|---|
| [`0.0.10498528`](https://hashscan.io/testnet/account/0.0.10498528) | Treasury, and the x402 service's `payTo` | 1,044.71 HBAR · 43.22 USDC |
| [`0.0.10498983`](https://hashscan.io/testnet/account/0.0.10498983) | The demo agent's wallet — the payer | 999.82 HBAR · 23.50 USDC |
| [`0.0.10498743`](https://hashscan.io/testnet/account/0.0.10498743) | A user wallet, on both sides of the loop | — |
| [`0.0.7314364`](https://hashscan.io/testnet/account/0.0.7314364) | Operator. Signs contract calls; cannot move funds anywhere but the configured targets | — |
| [`0.0.7162784`](https://hashscan.io/testnet/account/0.0.7162784) | Blocky402 facilitator — the fee payer on x402 payments | — |

EVM aliases, for anything that speaks addresses rather than ids:
treasury `0xb620e9af51531765cd91603d1222e86a6c3c50b8`,
agent `0x5c41a1f1cd91db2861c8ffc8b1115c4e14b1c6c7`.

## Token

**USDC** — [`0.0.5449`](https://hashscan.io/testnet/token/0.0.5449), EVM
`0x0000000000000000000000000000000000001549`, 6 decimals.

Six decimals is why there is no conversion step anywhere in the ledger: a USDC
base unit and a credit micro are the same number, so a dollar sent is a dollar
of credits.

---

## 1. An agent pays for inference

**[0.0.7162784@1789210503.635358513](https://hashscan.io/testnet/transaction/0.0.7162784@1789210503.635358513)** — `CRYPTOTRANSFER`, `SUCCESS`

| Account | Δ tinybars | Role |
|---|---:|---|
| `0.0.10498983` | −1,000,000 | agent, the payer |
| `0.0.10498528` | +1,000,000 | service, `payTo` |
| `0.0.7162784` | −268,834 | Blocky402, fee payer |
| `0.0.802` | +268,834 | network fee |

0.01 HBAR for one call. The third row is the point: **the agent never pays
gas** — the facilitator signs as fee payer, which is what `extra.feePayer` in
the 402 announces, so an agent needs HBAR only for the price itself.

Full decode of the 402 and how to reproduce it: [`x402-run.md`](./x402-run.md).

## 2. An advertiser funds a campaign

**[0.0.7314364@1789221234.139754133](https://hashscan.io/testnet/transaction/0.0.7314364@1789221234.139754133)** — `fund(bytes32,uint256)`

```
treasury        −100.00 USDC
CampaignVault   +100.00 USDC
```

## 3. The campaign settles, three ways

**[0.0.7314364@1789221257.884494799](https://hashscan.io/testnet/transaction/0.0.7314364@1789221257.884494799)** — `settle(bytes32,uint256,uint256,uint256)`

```
CampaignVault    −70.00 USDC  →  RewardPool   +70.00   the developers' share
CampaignVault    −20.00 USDC  →  treasury     +20.00
CampaignVault    −10.00 USDC  →  treasury     +10.00
```

One hundred dollars of advertiser spend, seventy of it moving to the pool
developers withdraw from. That is the 70% on the landing page, on chain, in one
transaction.

The contract is deliberately ignorant of why the split is 70/20/10 — the
amounts are computed off-chain and passed in, so a campaign funded under one
split settles under the split it was created with, with no migration on chain.

## 4. Users withdraw

| Transaction | Amount | To |
|---|---:|---|
| [0.0.7314364@1789221291.733974890](https://hashscan.io/testnet/transaction/0.0.7314364@1789221291.733974890) | 25.00 USDC | `0.0.10498983` |
| [0.0.7314364@1789221672.169271207](https://hashscan.io/testnet/transaction/0.0.7314364@1789221672.169271207) | 1.50 USDC | `0.0.10498983` |
| [0.0.7314364@1789244942.193856134](https://hashscan.io/testnet/transaction/0.0.7314364@1789244942.193856134) | 1.20 USDC | `0.0.10498743` |

Each is `RewardPool.payout(bytes32 payoutId, address to, uint256 amount)`, paid
out of the 70 USDC settled in step 3.

### Idempotency, proven not claimed

**[0.0.7314364@1789221301.463657733](https://hashscan.io/testnet/transaction/0.0.7314364@1789221301.463657733)** — `CONTRACT_REVERT_EXECUTED`

Nine seconds after the 25 USDC payout above, the same call was made again. Read
the two calldatas side by side:

```
1789221298  payout  id=0xfe2d443c9951d20a…  to=0x5c41a1f1…  25.0   SUCCESS
1789221307  payout  id=0xfe2d443c9951d20a…  to=0x5c41a1f1…  25.0   REVERTED
```

Identical payout id, identical recipient, identical amount — and the contract
refused it. That is `AlreadyPaid`, and it is why the withdrawal path can debit
the ledger *before* it touches the chain: a crash can only ever leave a user
owed money rather than paid twice, and the retry that settles it is safe to run
blindly.

## 5. Users buy credits

| Transaction | Amount | From |
|---|---:|---|
| [0.0.7314364@1789221991.613525189](https://hashscan.io/testnet/transaction/0.0.7314364@1789221991.613525189) | 3.00 USDC | `0.0.10498983` |
| [0.0.7314364@1789245503.464096370](https://hashscan.io/testnet/transaction/0.0.7314364@1789245503.464096370) | 0.50 USDC | `0.0.10498743` |

Both land in the treasury, and neither is credited until the mirror node
confirms it — the server never trusts a hash the browser hands it. The `txId`
unique constraint on `payments` is what stops the same transfer being credited
twice; the replay guard is a database constraint, not a code path that has to
remember to check.

---

## Verifying any of this yourself

Every id above can be read straight off the mirror node. Replace `@` and the
final `.` with `-`:

```bash
curl -s https://testnet.mirrornode.hedera.com/api/v1/transactions/0.0.7314364-1789221257-884494799
```

Contract state, without an explorer:

```bash
curl -s https://testnet.mirrornode.hedera.com/api/v1/contracts/0.0.10502343
curl -s https://testnet.mirrornode.hedera.com/api/v1/accounts/0.0.10498528
```
