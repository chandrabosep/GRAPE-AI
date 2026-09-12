import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { defineConfig, env } from 'prisma/config';

// The Prisma CLI runs with cwd=packages/db, but the workspace keeps one .env at
// the repo root. Load that first, then any package-local override.
const here = dirname(fileURLToPath(import.meta.url));
for (const candidate of [join(here, '..', '..', '.env'), join(here, '.env')]) {
  if (existsSync(candidate)) loadEnv({ path: candidate, override: false });
}

/**
 * Prisma 7 config.
 *
 * The CLI (migrate, introspect) talks to the DIRECT connection on 5432.
 * The application talks to the pooled connection on 6543 through the driver
 * adapter in src/client.ts. Pointing migrations at pgbouncer breaks advisory
 * locks, so these two must stay separate.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env('DIRECT_URL'),
  },
});
