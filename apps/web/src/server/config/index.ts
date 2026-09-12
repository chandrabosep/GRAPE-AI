import { economicsConfigSchema, type EconomicsConfig } from '@aam/shared';
import { z } from 'zod';
import economicsJson from './economics.json' with { type: 'json' };

/**
 * Single validated view of the runtime environment.
 *
 * Every secret is read here and nowhere else, and nothing in this file is safe
 * to import from a client component. Fields that only matter to one integration
 * are optional so the app still boots with a partial .env — the module that
 * needs a missing key fails loudly when it is actually used, which keeps the
 * "keys arrive later" workflow from blocking unrelated development.
 */

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  DATABASE_URL: z.string().min(1).optional(),
  DIRECT_URL: z.string().min(1).optional(),

  JWT_SECRET: z.string().min(16).default('dev-only-not-a-real-secret-change-me'),
  ADMIN_TOKEN: z.string().min(4).default('dev-admin-token'),

  AWS_REGION: z.string().default('us-east-1'),
  /**
   * Long-lived Bedrock API key ("ABSK..."). When set, the runtime client
   * authenticates with a bearer token instead of SigV4, which is what lets the
   * app run without an AWS profile, SSO login or instance role. Falls back to
   * the SDK default credential chain when absent.
   */
  BEDROCK_API_KEY: z.string().optional(),
  /**
   * Cross-region inference profile ids. Bedrock has no in-Region id for these
   * models, so the `us.` prefix is required, not cosmetic.
   */
  BEDROCK_CHAT_MODEL: z.string().default('us.anthropic.claude-sonnet-4-6'),
  BEDROCK_PREMIUM_MODEL: z
    .string()
    .default('us.anthropic.claude-opus-4-5-20251101-v1:0'),
  BEDROCK_CLASSIFIER_MODEL: z
    .string()
    .default('us.anthropic.claude-haiku-4-5-20251001-v1:0'),
  /** Set to "fake" to run the whole stack without AWS credentials. */
  AI_PROVIDER: z.enum(['bedrock', 'fake']).default('bedrock'),

  /// Wallet sign-in needs no server credentials. This is the explicit off
  /// switch for the seeded development sign-in, which is also refused in
  /// production regardless.
  DISABLE_DEV_AUTH: z.coerce.boolean().default(false),
  /// Optional: enables WalletConnect alongside injected wallets.
  NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: z.string().optional(),

  GRAPH_GATEWAY_API_KEY: z.string().optional(),
  PINAX_API_JWT: z.string().optional(),
  PINAX_API_URL: z.string().default('https://api.pinax.network'),

  CHAIN_ID: z.coerce.number().int().default(296),
  RPC_URL: z.string().default('https://testnet.hashio.io/api'),
  EXPLORER_URL: z.string().default('https://hashscan.io/testnet'),
  CAMPAIGN_VAULT_ADDRESS: z.string().optional(),
  REWARD_POOL_ADDRESS: z.string().optional(),
  MOCK_USDC_ADDRESS: z.string().optional(),
  OPERATOR_PRIVATE_KEY: z.string().optional(),

  NEXT_PUBLIC_APP_URL: z.string().default('http://localhost:3001'),
});

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | null = null;

export function env(): Env {
  if (!cachedEnv) {
    const parsed = envSchema.safeParse(process.env);
    if (!parsed.success) {
      throw new Error(`Invalid environment:\n${z.prettifyError(parsed.error)}`);
    }
    cachedEnv = parsed.data;
  }
  return cachedEnv;
}

let cachedEconomics: EconomicsConfig | null = null;

/** Economics is data, not code: every payout number comes from economics.json. */
export function economics(): EconomicsConfig {
  if (!cachedEconomics) {
    cachedEconomics = economicsConfigSchema.parse(economicsJson);
  }
  return cachedEconomics;
}

/** Throws a clear, actionable error when an integration is used before its keys land. */
export function requireEnv<K extends keyof Env>(key: K): NonNullable<Env[K]> {
  const value = env()[key];
  if (value === undefined || value === null || value === '') {
    throw new Error(
      `${String(key)} is not configured. Add it to .env (see .env.example) before using this feature.`,
    );
  }
  return value as NonNullable<Env[K]>;
}
