// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {TestToken} from "./TestToken.sol";
import {RewardPool} from "../src/RewardPool.sol";

contract RewardPoolTest is Test {
    TestToken internal token;
    RewardPool internal pool;

    address internal operator = makeAddr("operator");
    address internal user = makeAddr("user");
    address internal attacker = makeAddr("attacker");

    bytes32 internal constant PAYOUT_ID = keccak256("payout-1");

    function setUp() public {
        token = new TestToken();
        pool = new RewardPool(token, operator);
        token.mint(address(pool), 1_000e6);
    }

    function test_payoutTransfersAndRecords() public {
        vm.prank(operator);
        pool.payout(PAYOUT_ID, user, 7e6);

        assertEq(token.balanceOf(user), 7e6);
        assertEq(pool.totalPaidOut(), 7e6);
        assertTrue(pool.paid(PAYOUT_ID));
    }

    /// The backend retries. Paying the same withdrawal twice would be a real loss.
    function test_payoutIsIdempotentPerPayoutId() public {
        vm.startPrank(operator);
        pool.payout(PAYOUT_ID, user, 7e6);
        vm.expectRevert(abi.encodeWithSelector(RewardPool.AlreadyPaid.selector, PAYOUT_ID));
        pool.payout(PAYOUT_ID, user, 7e6);
        vm.stopPrank();

        assertEq(token.balanceOf(user), 7e6);
    }

    function test_payoutRejectsNonOperator() public {
        vm.prank(attacker);
        vm.expectRevert(RewardPool.NotOperator.selector);
        pool.payout(PAYOUT_ID, attacker, 1e6);
    }

    function test_payoutCannotExceedThePoolBalance() public {
        vm.prank(operator);
        vm.expectRevert(
            abi.encodeWithSelector(RewardPool.InsufficientPoolBalance.selector, 2_000e6, 1_000e6)
        );
        pool.payout(PAYOUT_ID, user, 2_000e6);
    }

    function test_payoutRejectsZeroAmountAndAddress() public {
        vm.startPrank(operator);
        vm.expectRevert(RewardPool.ZeroAmount.selector);
        pool.payout(PAYOUT_ID, user, 0);

        vm.expectRevert(RewardPool.ZeroAddress.selector);
        pool.payout(PAYOUT_ID, address(0), 1e6);
        vm.stopPrank();
    }

    function testFuzz_payoutsNeverExceedFunding(uint96[5] calldata amounts) public {
        uint256 funded = token.balanceOf(address(pool));
        uint256 sent;

        for (uint256 i = 0; i < amounts.length; i++) {
            if (amounts[i] == 0 || sent + amounts[i] > funded) continue;
            vm.prank(operator);
            pool.payout(keccak256(abi.encode(i)), user, amounts[i]);
            sent += amounts[i];
        }

        assertEq(token.balanceOf(user), sent);
        assertEq(token.balanceOf(address(pool)), funded - sent);
    }
}
