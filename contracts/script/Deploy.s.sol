// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
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
 *   USDC_ADDRESS      optional; deploys MockUSDC when unset
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
            usdc = address(new MockUSDC());
            console.log("MockUSDC        ", usdc);
        } else {
            console.log("Using token     ", usdc);
        }

        RewardPool pool = new RewardPool(MockUSDC(usdc), operator);
        console.log("RewardPool      ", address(pool));

        CampaignVault vault = new CampaignVault(
            MockUSDC(usdc), operator, address(pool), platformWallet, treasuryWallet
        );
        console.log("CampaignVault   ", address(vault));

        vm.stopBroadcast();

        console.log("");
        console.log("Add to .env:");
        console.log("MOCK_USDC_ADDRESS=%s", usdc);
        console.log("REWARD_POOL_ADDRESS=%s", address(pool));
        console.log("CAMPAIGN_VAULT_ADDRESS=%s", address(vault));
    }
}
