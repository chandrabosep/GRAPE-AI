# Contracts

Three small contracts. Blockchain is used for funding, settlement and payout, and
nothing else: impressions, individual rewards and AI usage all stay off chain,
because putting a fraction-of-a-cent reward on chain would cost more than the
reward is worth and would publish exactly the behavioural trail the product
promises not to expose.

| Contract | Purpose |
|---|---|
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
export USDC_ADDRESS=0x0000000000000000000000000000000000068cda
forge script script/Deploy.s.sol --rpc-url https://testnet.hashio.io/api --broadcast
```

The script prints the three addresses to paste into the root `.env`.

## Hedera testnet

The target chain is **Hedera testnet (296)**, reached over the HashIO JSON-RPC
relay — the same network the x402 agent payments settle on, so the project has
one chain rather than two.

The token is **HTS USDC**, `0.0.429274`, which the EVM reaches through its alias
`0x0000000000000000000000000000000000068cda`. It answers the ordinary ERC-20
interface, so `CampaignVault` and `RewardPool` hold it through plain `IERC20`
with no wrapper, and its 6 decimals mean one token base unit is exactly one
micro-USD in the ledger. No conversion exists anywhere in the codebase, which is
the point.

Verified against the live RPC on 2026-09-12: `eth_chainId` → `0x128` (296),
`decimals()` → `6`, `symbol()` → `USDC`.

Gas is paid in **HBAR**, not in the token being moved, so the deployer needs an
HBAR balance — get one at <https://portal.hedera.com>.

### The association caveat

Hedera requires an account to be associated with an HTS token before it can
receive it. Contracts created through the EVM get automatic association slots,
but this is the one Hedera-specific behaviour that has no equivalent on other
EVM chains, so **verify it with a real transfer before trusting a deployment**:
a vault that cannot receive USDC fails at funding time, not at deploy time.

There is no mock fallback. `USDC_ADDRESS` is required and the deploy reverts
without it, because a script that quietly substitutes play money is how a demo
ends up settling campaigns against a token nobody can withdraw.

The unit tests use `test/TestToken.sol`, a six-decimal ERC-20 that exists only
under `test/` and is never compiled into anything deployable — the vault needs
some token to hold in a unit test, and HTS USDC does not exist on a local EVM.

Get real testnet USDC from <https://faucet.circle.com> with **Hedera Testnet**
selected. Accounts created through the Hedera portal come with unlimited
automatic token association, so they can receive it with no association step.
