#!/usr/bin/env tsx
/**
 * Quick smoke test: queries five live subgraphs via the blockchain tool.
 * Run: pnpm tsx scripts/test-graph.mts
 */
import { readFileSync } from 'node:fs';

for (const line of readFileSync('.env', 'utf8').split('\n')) {
  const match = line.match(/^([A-Z_][A-Z0-9_]*)="(.+)"$/);
  if (match) process.env[match[1]!] = match[2]!;
}

const { executeBlockchainQuery } = await import(
  '../apps/web/src/server/modules/graph/blockchain-tool.ts'
);

async function run() {
  console.log('=== Aave V3 — protocol TVL ===');
  const aave = await executeBlockchainQuery({
    protocol: 'aave-v3',
    query: `{
      protocols(first: 1) {
        name
        totalValueLockedUSD
        totalPoolCount
        cumulativeSupplySideRevenueUSD
      }
    }`,
  });
  console.log(aave.content);

  console.log('\n=== Uniswap V3 — latest swaps ===');
  const swaps = await executeBlockchainQuery({
    protocol: 'uniswap-v3',
    query: `{
      swaps(first: 3, orderBy: timestamp, orderDirection: desc) {
        id
        timestamp
        amountInUSD
        amountOutUSD
      }
    }`,
  });
  console.log(swaps.content);

  console.log('\n=== Curve — protocol stats ===');
  const curve = await executeBlockchainQuery({
    protocol: 'curve',
    query: `{
      protocols(first: 1) {
        name
        totalValueLockedUSD
        totalPoolCount
      }
    }`,
  });
  console.log(curve.content);

  console.log('\n=== ENS — recent domains ===');
  const ens = await executeBlockchainQuery({
    protocol: 'ens',
    query: `{
      domains(first: 3, orderBy: createdAt, orderDirection: desc) {
        name
        createdAt
        owner { id }
      }
    }`,
  });
  console.log(ens.content);

  console.log('\n=== Sushiswap V3 — pool count ===');
  const sushi = await executeBlockchainQuery({
    protocol: 'sushiswap-v3',
    query: `{
      protocols(first: 1) {
        name
        totalValueLockedUSD
        totalPoolCount
      }
    }`,
  });
  console.log(sushi.content);
}

run().catch(console.error);
