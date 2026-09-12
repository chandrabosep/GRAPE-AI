// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title TestToken
 * @notice Six-decimal ERC-20 used only by this test suite.
 * @dev Lives under test/ and is never compiled into anything deployable. The
 *      vault and pool need *some* token to hold in a unit test, and the real
 *      settlement token is HTS USDC, which does not exist on a local EVM. So
 *      the fixture stands in for it there and nowhere else — deployments pass
 *      the real token address or they do not deploy.
 */
contract TestToken is ERC20 {
    uint8 private constant DECIMALS = 6;

    constructor() ERC20("Test USD Coin", "tUSDC") {}

    function decimals() public pure override returns (uint8) {
        return DECIMALS;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
