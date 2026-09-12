# Contracts

Three small contracts. Blockchain is used for funding, settlement and payout, and
nothing else: impressions, individual rewards and AI usage all stay off chain,
because putting a fraction-of-a-cent reward on chain would cost more than the
reward is worth and would publish exactly the behavioural trail the product
promises not to expose.

| Contract | Purpose |
|---|---|
| `MockUSDC` | Six-decimal test token with an open mint. Local chains only — real networks pass their own USDC. |
| `CampaignVault` | Holds advertiser budgets, settles them three ways, refunds the remainder. |
| `RewardPool` | Holds the users' share and pays withdrawals, idempotently. |

## The security model

The operator is a backend key, so it is assumed to be compromised eventually. The
tests are written around what it *cannot* do:

- It chooses settlement amounts but not destinations. Funds can only reach the
  reward pool, the platform wallet or the treasury wallet, all set by the owner.
- It can never settle more than a campaign has left unsettled.
- A payout id can only be paid once, so a retried backend job cannot double-pay.

A fuzz test asserts that across arbitrary settlement splits, no value ever
reaches an arbitrary address.

The allocation percentages are deliberately **not** in the contract. The backend
passes amounts, which keeps the split configurable and lets a campaign settle
under the split it was created with.

## Setup

`lib/` is not committed, so install dependencies first:

```bash
forge install foundry-rs/forge-std
forge install OpenZeppelin/openzeppelin-contracts
forge build
forge test
```

## Deploy

```bash
export PRIVATE_KEY=0x...          # deployer, becomes owner
export OPERATOR_ADDRESS=0x...     # backend
export PLATFORM_WALLET=0x...
export TREASURY_WALLET=0x...
export USDC_ADDRESS=0x3600000000000000000000000000000000000000
forge script script/Deploy.s.sol --rpc-url https://rpc.testnet.arc.network --broadcast
```

The script prints the three addresses to paste into the root `.env`.

## Arc testnet

The target chain is **Arc testnet (5042002)**, Circle's stablecoin L1, and the
token is **real testnet USDC** rather than the mock. Two properties of Arc
matter here:

- **USDC is the native gas token.** Deployment and every settlement transaction
  is paid for in the same asset the campaign is denominated in — a deploy costs
  about `0.074 USDC` at 42 gwei. Fund the deployer at
  <https://faucet.circle.com>. There is no second gas asset to hold.
- **The same balance is exposed as a 6-decimal ERC-20** at
  `0x3600000000000000000000000000000000000000`, so `CampaignVault` and
  `RewardPool` use it through the plain `IERC20` interface with no wrapper, and
  one token base unit is exactly one micro-USD in the ledger. No conversion
  exists anywhere in the codebase, which is the point.

Verified against the live RPC on 2026-09-12: `eth_chainId` → `0x4cef52`
(5042002), `decimals()` → `6`, `symbol()` → `USDC`, and `forge script`
simulates the full deployment cleanly against live chain state.

Note that the Arc docs list the chain ID hex as `0x4CA812`, which does not match
the decimal they give; the chain itself answers `0x4cef52`. Trust the chain.
