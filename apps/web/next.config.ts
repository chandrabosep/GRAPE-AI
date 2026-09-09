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

const nextConfig: NextConfig = {
  // Turbopack transpiles workspace packages automatically, so the shared
  // packages can ship raw TypeScript with no build step.
  turbopack: {},
};

export default nextConfig;
