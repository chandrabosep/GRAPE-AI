// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockUSDC
 * @notice Six-decimal test token standing in for USDC on testnets.
 * @dev Minting is deliberately open. This exists so an advertiser can fund a
 *      campaign in a demo without hunting for a faucet, and it must never be
 *      deployed anywhere that matters.
 */
contract MockUSDC is ERC20 {
    uint8 private constant DECIMALS = 6;

    constructor() ERC20("Mock USD Coin", "mUSDC") {}

    function decimals() public pure override returns (uint8) {
        return DECIMALS;
    }

    /// @notice Anyone may mint. Testnet only.
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
