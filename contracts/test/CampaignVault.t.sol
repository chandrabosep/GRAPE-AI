// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {CampaignVault} from "../src/CampaignVault.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {RewardPool} from "../src/RewardPool.sol";

/**
 * The properties that matter are about what the operator key CANNOT do. It runs
 * on a server, so the tests assume it will eventually be compromised and check
 * that the blast radius is misallocation between three fixed addresses rather
 * than draining the vault.
 */
contract CampaignVaultTest is Test {
    MockUSDC internal token;
    RewardPool internal pool;
    CampaignVault internal vault;

    address internal operator = makeAddr("operator");
    address internal platform = makeAddr("platform");
    address internal treasury = makeAddr("treasury");
    address internal advertiser = makeAddr("advertiser");
    address internal attacker = makeAddr("attacker");

    bytes32 internal constant KEY = keccak256("campaign-1");
    uint256 internal constant BUDGET = 100e6; // $100 at 6 decimals

    function setUp() public {
        token = new MockUSDC();
        pool = new RewardPool(token, operator);
        vault = new CampaignVault(token, operator, address(pool), platform, treasury);

        token.mint(advertiser, BUDGET);
        vm.prank(advertiser);
        token.approve(address(vault), type(uint256).max);
    }

    function _fund(uint256 amount) internal {
        vm.prank(advertiser);
        vault.fund(KEY, amount);
    }

    // ------------------------------------------------------------- funding

    function test_fundRecordsDepositAndAdvertiser() public {
        _fund(BUDGET);

        (address recorded, uint256 deposited, uint256 settled, bool closed) = vault.campaigns(KEY);
        assertEq(recorded, advertiser);
        assertEq(deposited, BUDGET);
        assertEq(settled, 0);
        assertFalse(closed);
        assertEq(token.balanceOf(address(vault)), BUDGET);
    }

    function test_fundIsAdditive() public {
        _fund(40e6);
        _fund(60e6);
        assertEq(vault.unsettled(KEY), BUDGET);
    }

    function test_fundRejectsADifferentAdvertiserOnTheSameCampaign() public {
        _fund(10e6);

        token.mint(attacker, 10e6);
        vm.startPrank(attacker);
        token.approve(address(vault), type(uint256).max);
        vm.expectRevert(CampaignVault.NotCampaignAdvertiser.selector);
        vault.fund(KEY, 10e6);
        vm.stopPrank();
    }

    function test_fundRejectsZero() public {
        vm.prank(advertiser);
        vm.expectRevert(CampaignVault.ZeroAmount.selector);
        vault.fund(KEY, 0);
    }

    // ----------------------------------------------------------- settlement

    function test_settleSplitsToTheThreeFixedDestinations() public {
        _fund(BUDGET);

        vm.prank(operator);
        vault.settle(KEY, 70e6, 20e6, 10e6);

        assertEq(token.balanceOf(address(pool)), 70e6);
        assertEq(token.balanceOf(platform), 20e6);
        assertEq(token.balanceOf(treasury), 10e6);
        assertEq(vault.unsettled(KEY), 0);
    }

    function test_settleCannotExceedWhatWasDeposited() public {
        _fund(BUDGET);

        vm.prank(operator);
        vm.expectRevert(
            abi.encodeWithSelector(CampaignVault.ExceedsUnsettled.selector, BUDGET + 1, BUDGET)
        );
        vault.settle(KEY, BUDGET + 1, 0, 0);
    }

    function test_settleAccumulatesAcrossBatches() public {
        _fund(BUDGET);

        vm.startPrank(operator);
        vault.settle(KEY, 7e6, 2e6, 1e6);
        vault.settle(KEY, 7e6, 2e6, 1e6);
        vm.stopPrank();

        assertEq(vault.unsettled(KEY), BUDGET - 20e6);
    }

    function test_settleRejectsNonOperator() public {
        _fund(BUDGET);

        vm.prank(attacker);
        vm.expectRevert(CampaignVault.NotOperator.selector);
        vault.settle(KEY, 1e6, 0, 0);
    }

    function test_settleRejectsUnknownCampaign() public {
        vm.prank(operator);
        vm.expectRevert(CampaignVault.UnknownCampaign.selector);
        vault.settle(keccak256("never-funded"), 1e6, 0, 0);
    }

    /// A compromised operator can misallocate, but every path still ends at one
    /// of three addresses it does not control.
    function testFuzz_settleNeverSendsFundsToAnArbitraryAddress(
        uint96 reward,
        uint96 platformAmount,
        uint96 treasuryAmount
    ) public {
        uint256 total = uint256(reward) + platformAmount + treasuryAmount;
        vm.assume(total > 0 && total <= BUDGET);
        _fund(BUDGET);

        vm.prank(operator);
        vault.settle(KEY, reward, platformAmount, treasuryAmount);

        assertEq(
            token.balanceOf(address(pool)) + token.balanceOf(platform) + token.balanceOf(treasury),
            total
        );
        assertEq(token.balanceOf(attacker), 0);
        assertEq(token.balanceOf(operator), 0);
    }

    // -------------------------------------------------------------- refunds

    function test_refundReturnsOnlyTheUnsettledRemainder() public {
        _fund(BUDGET);

        vm.prank(operator);
        vault.settle(KEY, 70e6, 20e6, 10e6);

        // Everything was settled, so there is nothing left to refund.
        vm.prank(advertiser);
        vault.refund(KEY);
        assertEq(token.balanceOf(advertiser), 0);
    }

    function test_refundReturnsRemainderAndClosesTheCampaign() public {
        _fund(BUDGET);

        vm.prank(operator);
        vault.settle(KEY, 7e6, 2e6, 1e6);

        vm.prank(advertiser);
        vault.refund(KEY);

        assertEq(token.balanceOf(advertiser), BUDGET - 10e6);

        vm.prank(operator);
        vm.expectRevert(CampaignVault.CampaignClosed.selector);
        vault.settle(KEY, 1e6, 0, 0);
    }

    function test_refundRejectsAStranger() public {
        _fund(BUDGET);

        vm.prank(attacker);
        vm.expectRevert(CampaignVault.NotCampaignAdvertiser.selector);
        vault.refund(KEY);
    }

    function test_closedCampaignCannotBeRefundedTwice() public {
        _fund(BUDGET);

        vm.startPrank(advertiser);
        vault.refund(KEY);
        vm.expectRevert(CampaignVault.CampaignClosed.selector);
        vault.refund(KEY);
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- admin

    function test_onlyOwnerCanChangeTheOperator() public {
        vm.prank(attacker);
        vm.expectRevert();
        vault.setOperator(attacker);

        vault.setOperator(attacker);
        assertEq(vault.operator(), attacker);
    }
}
