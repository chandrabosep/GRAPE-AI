// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title RewardPool
 * @notice Holds the users' share of settled campaign spend and pays withdrawals.
 *
 * @dev Individual rewards are accrued off-chain, for the same reason impressions
 *      are: putting every few-thousandths-of-a-cent reward on chain would cost
 *      more in gas than the reward is worth, and would publish exactly the
 *      behavioural trail the product promises not to expose. This contract sees
 *      only aggregate settlement in and withdrawals out.
 *
 *      Payouts are idempotent per payoutId so a retried or duplicated backend
 *      job cannot pay the same withdrawal twice.
 */
contract RewardPool is Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;

    address public operator;

    mapping(bytes32 payoutId => bool) public paid;
    uint256 public totalPaidOut;

    event OperatorUpdated(address indexed operator);
    event Payout(bytes32 indexed payoutId, address indexed to, uint256 amount);

    error NotOperator();
    error ZeroAmount();
    error ZeroAddress();
    error AlreadyPaid(bytes32 payoutId);
    error InsufficientPoolBalance(uint256 requested, uint256 available);

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    constructor(IERC20 token_, address operator_) Ownable(msg.sender) {
        if (address(token_) == address(0)) revert ZeroAddress();
        token = token_;
        _setOperator(operator_);
    }

    function setOperator(address operator_) external onlyOwner {
        _setOperator(operator_);
    }

    /**
     * @notice Pays one withdrawal.
     * @param payoutId Off-chain identifier for this withdrawal. Replays are rejected.
     */
    function payout(bytes32 payoutId, address to, uint256 amount) external onlyOperator {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (paid[payoutId]) revert AlreadyPaid(payoutId);

        uint256 balance = token.balanceOf(address(this));
        if (amount > balance) revert InsufficientPoolBalance(amount, balance);

        paid[payoutId] = true;
        totalPaidOut += amount;

        token.safeTransfer(to, amount);

        emit Payout(payoutId, to, amount);
    }

    function available() external view returns (uint256) {
        return token.balanceOf(address(this));
    }

    function _setOperator(address operator_) private {
        if (operator_ == address(0)) revert ZeroAddress();
        operator = operator_;
        emit OperatorUpdated(operator_);
    }
}
