// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title CampaignVault
 * @notice Holds advertiser campaign budgets and settles them three ways.
 *
 * @dev Deliberately ignorant of the marketplace's economics. The contract knows
 *      only how much was deposited and how much has been settled; the split
 *      between user rewards, platform and treasury is computed off-chain and
 *      passed in as amounts. That keeps the allocation configurable, and lets a
 *      campaign that was funded under one split settle under the split it was
 *      created with, without any migration here.
 *
 *      High-volume events (impressions, individual rewards) never touch this
 *      contract. It exists for funding and periodic settlement only.
 */
contract CampaignVault is Ownable {
    using SafeERC20 for IERC20;

    struct Campaign {
        address advertiser;
        uint256 deposited;
        uint256 settled;
        bool closed;
    }

    IERC20 public immutable token;

    /// @notice Backend address permitted to settle. Not permitted to move funds elsewhere.
    address public operator;

    address public rewardPool;
    address public platformWallet;
    address public treasuryWallet;

    mapping(bytes32 campaignKey => Campaign) public campaigns;

    event OperatorUpdated(address indexed operator);
    event PayoutTargetsUpdated(address rewardPool, address platformWallet, address treasuryWallet);
    event Funded(bytes32 indexed campaignKey, address indexed advertiser, uint256 amount);
    event Settled(
        bytes32 indexed campaignKey,
        uint256 rewardAmount,
        uint256 platformAmount,
        uint256 treasuryAmount
    );
    event Refunded(bytes32 indexed campaignKey, address indexed advertiser, uint256 amount);

    error NotOperator();
    error ZeroAmount();
    error ZeroAddress();
    error UnknownCampaign();
    error NotCampaignAdvertiser();
    error CampaignClosed();
    error ExceedsUnsettled(uint256 requested, uint256 available);

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    constructor(
        IERC20 token_,
        address operator_,
        address rewardPool_,
        address platformWallet_,
        address treasuryWallet_
    ) Ownable(msg.sender) {
        if (address(token_) == address(0)) revert ZeroAddress();
        token = token_;
        _setOperator(operator_);
        _setPayoutTargets(rewardPool_, platformWallet_, treasuryWallet_);
    }

    // --------------------------------------------------------------- admin

    function setOperator(address operator_) external onlyOwner {
        _setOperator(operator_);
    }

    function setPayoutTargets(address rewardPool_, address platformWallet_, address treasuryWallet_)
        external
        onlyOwner
    {
        _setPayoutTargets(rewardPool_, platformWallet_, treasuryWallet_);
    }

    // ------------------------------------------------------------ advertiser

    /**
     * @notice Deposits budget for a campaign.
     * @dev Additive: topping up an existing campaign is the same call. The first
     *      funder becomes the campaign's advertiser and is the only address that
     *      can later be refunded.
     */
    function fund(bytes32 campaignKey, uint256 amount) external {
        if (amount == 0) revert ZeroAmount();

        Campaign storage campaign = campaigns[campaignKey];
        if (campaign.closed) revert CampaignClosed();

        if (campaign.advertiser == address(0)) {
            campaign.advertiser = msg.sender;
        } else if (campaign.advertiser != msg.sender) {
            revert NotCampaignAdvertiser();
        }

        campaign.deposited += amount;
        token.safeTransferFrom(msg.sender, address(this), amount);

        emit Funded(campaignKey, msg.sender, amount);
    }

    /**
     * @notice Returns everything not yet settled and closes the campaign.
     * @dev Callable by the advertiser or the owner. Closing is one-way, so a
     *      refunded campaign cannot be resurrected and settled against.
     */
    function refund(bytes32 campaignKey) external {
        Campaign storage campaign = campaigns[campaignKey];
        if (campaign.advertiser == address(0)) revert UnknownCampaign();
        if (msg.sender != campaign.advertiser && msg.sender != owner()) {
            revert NotCampaignAdvertiser();
        }
        if (campaign.closed) revert CampaignClosed();

        uint256 remaining = campaign.deposited - campaign.settled;
        campaign.closed = true;

        if (remaining > 0) {
            campaign.settled = campaign.deposited;
            token.safeTransfer(campaign.advertiser, remaining);
        }

        emit Refunded(campaignKey, campaign.advertiser, remaining);
    }

    // -------------------------------------------------------------- operator

    /**
     * @notice Settles a batch of accrued spend for one campaign.
     * @dev The operator chooses the amounts but cannot choose the destinations,
     *      and can never move more than the campaign has left unsettled. That is
     *      the whole security model: a compromised operator key can misallocate
     *      between three fixed addresses, not drain the vault.
     */
    function settle(
        bytes32 campaignKey,
        uint256 rewardAmount,
        uint256 platformAmount,
        uint256 treasuryAmount
    ) external onlyOperator {
        Campaign storage campaign = campaigns[campaignKey];
        if (campaign.advertiser == address(0)) revert UnknownCampaign();
        if (campaign.closed) revert CampaignClosed();

        uint256 total = rewardAmount + platformAmount + treasuryAmount;
        if (total == 0) revert ZeroAmount();

        uint256 available = campaign.deposited - campaign.settled;
        if (total > available) revert ExceedsUnsettled(total, available);

        campaign.settled += total;

        if (rewardAmount > 0) token.safeTransfer(rewardPool, rewardAmount);
        if (platformAmount > 0) token.safeTransfer(platformWallet, platformAmount);
        if (treasuryAmount > 0) token.safeTransfer(treasuryWallet, treasuryAmount);

        emit Settled(campaignKey, rewardAmount, platformAmount, treasuryAmount);
    }

    // ----------------------------------------------------------------- views

    function unsettled(bytes32 campaignKey) external view returns (uint256) {
        Campaign storage campaign = campaigns[campaignKey];
        return campaign.deposited - campaign.settled;
    }

    // -------------------------------------------------------------- internal

    function _setOperator(address operator_) private {
        if (operator_ == address(0)) revert ZeroAddress();
        operator = operator_;
        emit OperatorUpdated(operator_);
    }

    function _setPayoutTargets(
        address rewardPool_,
        address platformWallet_,
        address treasuryWallet_
    ) private {
        if (
            rewardPool_ == address(0) || platformWallet_ == address(0)
                || treasuryWallet_ == address(0)
        ) {
            revert ZeroAddress();
        }
        rewardPool = rewardPool_;
        platformWallet = platformWallet_;
        treasuryWallet = treasuryWallet_;
        emit PayoutTargetsUpdated(rewardPool_, platformWallet_, treasuryWallet_);
    }
}
