import { prisma } from '@aam/db';
import { AppError } from '@aam/shared';
import { createPublicClient, getAddress, http, keccak256, parseAbi, toHex, type Hex } from 'viem';
import { hederaTestnet } from 'viem/chains';
import { env } from '../../config/index';
import { logger } from '../../lib/logger';

/**
 * Campaign funding, on chain.
 *
 * An advertiser deposits their budget into `CampaignVault` from their own
 * wallet. `fund` is permissionless and pulls with `transferFrom`, so nobody
 * here holds the money or signs for them: the browser sends `approve` then
 * `fund`, and this module's only job is to read back what the vault says it
 * holds.
 *
 * That direction matters. Nothing trusts a transaction hash from the client to
 * decide how much was funded — the hash is recorded for the audit trail, but
 * the *amount* always comes from `campaigns(key).deposited`, which is the
 * chain's own tally. Reading state rather than events means a top-up, a
 * double-submitted receipt and a deposit made directly from a wallet all
 * converge on the same answer, and there is no replay to guard against because
 * a total cannot be counted twice.
 */

const VAULT_ABI = parseAbi([
  'function campaigns(bytes32) view returns (address advertiser, uint256 deposited, uint256 settled, bool closed)',
]);

/**
 * The bytes32 key the vault files this campaign under.
 *
 * Derived from our own id rather than stored as a random value, so it can be
 * recomputed from the database at any time — and so a campaign row that lost
 * its `vaultKey` column can still find its money.
 */
export function vaultKeyFor(campaignId: string): Hex {
  return keccak256(toHex(campaignId));
}

export interface FundingState {
  /** False on a deployment with no vault configured; the UI hides funding entirely. */
  configured: boolean;
  campaignKey: Hex;
  vaultAddress: string | null;
  tokenAddress: string;
  chainId: number;
  rpcUrl: string;
  explorerUrl: string;
  budgetMicro: bigint;
  /** What the vault holds for this campaign. USDC and the ledger are both 6dp. */
  depositedMicro: bigint;
  settledMicro: bigint;
  /** Still to deposit before the campaign may launch. Never negative. */
  outstandingMicro: bigint;
  funded: boolean;
  /** The first funder. Only this address may later be refunded. */
  advertiserAddress: string | null;
  closed: boolean;
}

function vaultAddress(): Hex | null {
  const address = env().CAMPAIGN_VAULT_ADDRESS;
  return address ? getAddress(address) : null;
}

async function assertOwnership(campaignId: string, advertiserId: string) {
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign || campaign.advertiserId !== advertiserId) {
    throw new AppError('not_found', 'Campaign not found');
  }
  return campaign;
}

/** Everything unfunded, for a deployment with no vault to fund into. */
function unconfigured(campaignId: string, budgetMicro: bigint): FundingState {
  return {
    configured: false,
    campaignKey: vaultKeyFor(campaignId),
    vaultAddress: null,
    tokenAddress: env().USDC_ADDRESS,
    chainId: env().CHAIN_ID,
    rpcUrl: env().RPC_URL,
    explorerUrl: env().EXPLORER_URL,
    budgetMicro,
    depositedMicro: 0n,
    settledMicro: 0n,
    outstandingMicro: budgetMicro,
    funded: false,
    advertiserAddress: null,
    closed: false,
  };
}

/**
 * What the vault holds for this campaign, right now.
 *
 * A read against the chain on every call rather than a cached column: the
 * advertiser can fund from any wallet at any time, including outside this UI,
 * and a stale "unfunded" badge on a campaign that has money in it is the kind
 * of thing that gets a working demo called broken.
 */
export async function fundingState(
  campaignId: string,
  advertiserId: string,
): Promise<FundingState> {
  const campaign = await assertOwnership(campaignId, advertiserId);
  const vault = vaultAddress();
  if (!vault) return unconfigured(campaignId, campaign.budgetMicro);

  const campaignKey = vaultKeyFor(campaignId);
  const client = createPublicClient({ chain: hederaTestnet, transport: http(env().RPC_URL) });

  let deposited = 0n;
  let settled = 0n;
  let advertiser: string | null = null;
  let closed = false;

  try {
    const [onchainAdvertiser, onchainDeposited, onchainSettled, onchainClosed] =
      await client.readContract({
        address: vault,
        abi: VAULT_ABI,
        functionName: 'campaigns',
        args: [campaignKey],
      });

    deposited = onchainDeposited;
    settled = onchainSettled;
    closed = onchainClosed;
    // The zero address is what an unfunded key reads back as, not a funder.
    advertiser =
      onchainAdvertiser === '0x0000000000000000000000000000000000000000'
        ? null
        : onchainAdvertiser;
  } catch (error) {
    // An unreachable RPC must not take the campaign page down with it. Reporting
    // zero deposited is the safe direction: the advertiser is shown as unfunded
    // and invited to fund, which the vault would then reject as a duplicate
    // only if it already held the money — and it does not, or we would have
    // read it.
    logger.warn({ err: error, campaignId }, 'could not read campaign funding from the vault');
  }

  const outstanding = campaign.budgetMicro - deposited;

  return {
    configured: true,
    campaignKey,
    vaultAddress: vault,
    tokenAddress: env().USDC_ADDRESS,
    chainId: env().CHAIN_ID,
    rpcUrl: env().RPC_URL,
    explorerUrl: env().EXPLORER_URL,
    budgetMicro: campaign.budgetMicro,
    depositedMicro: deposited,
    settledMicro: settled,
    outstandingMicro: outstanding > 0n ? outstanding : 0n,
    funded: deposited >= campaign.budgetMicro && campaign.budgetMicro > 0n,
    advertiserAddress: advertiser,
    closed,
  };
}

/**
 * Records a deposit the browser has just made, and returns the new state.
 *
 * The hash is written to `payments` for the audit trail and pinned by the
 * table's unique constraint so one transfer cannot be filed twice. It is
 * deliberately *not* what decides the funded amount — that is read back off the
 * vault above — so a lost receipt costs the advertiser nothing and a forged one
 * buys them nothing.
 */
export async function recordFunding(
  campaignId: string,
  advertiserId: string,
  txHash: string,
): Promise<FundingState> {
  const campaign = await assertOwnership(campaignId, advertiserId);
  const state = await fundingState(campaignId, advertiserId);
  if (!state.configured) {
    throw new AppError('upstream_unavailable', 'Campaign funding is not configured on this deployment');
  }

  const payment = await prisma.payment
    .create({
      data: {
        kind: 'campaign_funding',
        network: `eip155:${env().CHAIN_ID}`,
        txId: txHash,
        fromAddress: state.advertiserAddress ?? 'onchain',
        toAddress: state.vaultAddress ?? 'unknown',
        asset: env().USDC_ADDRESS,
        amountRaw: state.depositedMicro.toString(),
        amountMicro: state.depositedMicro,
        status: 'confirmed',
        campaignId,
        confirmedAt: new Date(),
        raw: { campaignKey: state.campaignKey },
      },
    })
    .catch((error: unknown) => {
      // Already filed — a double-submitted receipt, or a retry. The vault read
      // above is still authoritative, so there is nothing to correct.
      logger.debug({ err: error, txHash }, 'funding receipt already recorded');
      return null;
    });

  await prisma.campaign.update({
    where: { id: campaignId },
    data: {
      vaultKey: state.campaignKey,
      ...(payment && !campaign.fundingPaymentId ? { fundingPaymentId: payment.id } : {}),
    },
  });

  return state;
}

/**
 * Whether this campaign's budget is on chain.
 *
 * Used by the readiness check, which is why it answers `true` when no vault is
 * configured: a deployment without contracts must still be able to run the
 * product, and refusing to launch anything would turn a missing address into a
 * dead application rather than a missing feature.
 */
export async function isFunded(campaignId: string): Promise<boolean> {
  const vault = vaultAddress();
  if (!vault) return true;

  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { advertiserId: true },
  });
  if (!campaign) return false;

  const state = await fundingState(campaignId, campaign.advertiserId);
  return state.funded;
}
