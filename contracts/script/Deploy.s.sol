// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {CampaignVault} from "../src/CampaignVault.sol";
import {RewardPool} from "../src/RewardPool.sol";

/**
 * Deploys the three contracts and wires them together.
 *
 * Order matters: the vault needs the pool's address, so the pool is deployed
 * first and the vault is pointed at it.
 *
 * Usage:
 *   forge script script/Deploy.s.sol --rpc-url $RPC_URL --broadcast
 *
 * Environment:
 *   PRIVATE_KEY       deployer, becomes contract owner
 *   OPERATOR_ADDRESS  backend address allowed to settle and pay out
 *   PLATFORM_WALLET   receives the platform share
 *   TREASURY_WALLET   receives the treasury share
 *   USDC_ADDRESS      the settlement token; required, and must be a real one
 *
 * On Hedera testnet (chain 296) the token is HTS USDC 0.0.429274, which the EVM
 * reaches at its alias 0x0000000000000000000000000000000000068cda with 6
 * decimals — pass that as USDC_ADDRESS and no mock is deployed. Gas is paid in
 * HBAR, so fund the deployer at https://portal.hedera.com.
 */
contract Deploy is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address operator = vm.envAddress("OPERATOR_ADDRESS");
        address platformWallet = vm.envAddress("PLATFORM_WALLET");
        address treasuryWallet = vm.envAddress("TREASURY_WALLET");
        // Required, and deliberately not defaulted. Silently deploying a stand-in
        // token when this is missing is how a demo ends up settling real
        // campaigns against play money nobody notices until withdrawal.
        address usdc = vm.envAddress("USDC_ADDRESS");
        require(usdc != address(0), "USDC_ADDRESS must be a real token");

        vm.startBroadcast(deployerKey);

        console.log("Settlement token", usdc);

        // Only the ERC-20 interface is ever needed. On Hedera that is HTS USDC
        // reached through its EVM alias, which answers ERC-20 like any token.
        IERC20 token = IERC20(usdc);

        RewardPool pool = new RewardPool(token, operator);
        console.log("RewardPool      ", address(pool));

        CampaignVault vault = new CampaignVault(
            token, operator, address(pool), platformWallet, treasuryWallet
        );
        console.log("CampaignVault   ", address(vault));

        vm.stopBroadcast();

        console.log("");
        console.log("Add to .env:");
        console.log("USDC_ADDRESS=%s", usdc);
        console.log("REWARD_POOL_ADDRESS=%s", address(pool));
        console.log("CAMPAIGN_VAULT_ADDRESS=%s", address(vault));
    }
}
