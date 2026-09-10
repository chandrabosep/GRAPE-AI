import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import type { NextConfig } from 'next';

// The workspace keeps a single .env at the repo root, but Next only looks inside
// the app directory. Load the root file first so one .env serves every app; a
// package-local .env still wins if someone adds one.
const here = dirname(fileURLToPath(import.meta.url));
for (const candidate of [join(here, '..', '..', '.env'), join(here, '.env')]) {
  if (existsSync(candidate)) loadEnv({ path: candidate, override: false });
}

// AppKit's wallet connectors reach x402 payment adapters through Coinbase's SDK.
// The EVM ones are installed for real, since this project uses x402 on Hedera
// anyway. Solana is not, and Turbopack resolves imports statically, so that one
// is aliased away rather than pulling in a Solana signing stack the wallet modal
// never touches.
const UNUSED_OPTIONAL_MODULES = ['@x402/svm/exact/client'];

const nextConfig: NextConfig = {
  // Turbopack transpiles workspace packages automatically, so the shared
  // packages can ship raw TypeScript with no build step.
  turbopack: {
    resolveAlias: Object.fromEntries(
      UNUSED_OPTIONAL_MODULES.map((name) => [name, './src/empty-module.ts']),
    ),
  },
};

export default nextConfig;
