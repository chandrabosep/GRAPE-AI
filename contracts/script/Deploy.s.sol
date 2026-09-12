// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {CampaignVault} from "../src/CampaignVault.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
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
 *   USDC_ADDRESS      real token to settle in; deploys MockUSDC when unset
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
        address usdc = vm.envOr("USDC_ADDRESS", address(0));

        vm.startBroadcast(deployerKey);

        if (usdc == address(0)) {
            // Local chains only. Any real deployment passes the network's USDC.
            usdc = address(new MockUSDC());
            console.log("MockUSDC        ", usdc);
        } else {
            console.log("Using token     ", usdc);
        }

        // Cast to IERC20, not MockUSDC: the token is whatever the chain's real
        // USDC is, and the contracts only ever need the ERC-20 interface.
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
