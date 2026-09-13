import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'prisma/config';

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
 *
 * The datasource is attached only when DIRECT_URL is actually set, rather than
 * declared with `env('DIRECT_URL')`, which resolves eagerly and throws when the
 * variable is missing — for every command, including ones that never open a
 * connection. `prisma generate` is exactly that: it reads the schema and writes
 * a client. Requiring a database URL to run it made the build depend on a
 * secret it does not use, and any environment holding the schema but not the
 * credentials failed at `db:generate` with `PrismaConfigEnvError` before the
 * app was even compiled.
 *
 * The commands that do need a connection — `migrate`, `db push`, `studio` —
 * still get one here when it exists, and when it does not, Prisma reports the
 * missing datasource itself rather than this file pre-empting it.
 */
const directUrl = process.env.DIRECT_URL;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  ...(directUrl ? { datasource: { url: directUrl } } : {}),
});
