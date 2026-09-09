# Contracts

Three small contracts. Blockchain is used for funding, settlement and payout, and
nothing else: impressions, individual rewards and AI usage all stay off chain,
because putting a fraction-of-a-cent reward on chain would cost more than the
reward is worth and would publish exactly the behavioural trail the product
promises not to expose.

| Contract | Purpose |
|---|---|
| `MockUSDC` | Six-decimal test token with an open mint. Testnet only. |
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
forge script script/Deploy.s.sol --rpc-url $RPC_URL --broadcast
```

The script prints the three addresses to paste into the root `.env`.

Target chain is decided by the Privy embedded-wallet spike described in the
implementation plan: Hedera testnet (296) if embedded wallets sign there
reliably, otherwise Base Sepolia (84532).
