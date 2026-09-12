import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

// The service runs as its own process on its own port, so it does not inherit
// Next.js's automatic .env loading. Everything shares the one root file.
loadEnv({ path: new URL('../../../.env', import.meta.url).pathname, quiet: true });

const schema = z.object({
  X402_FACILITATOR_URL: z.string().url(),
  X402_NETWORK: z.custom<`${string}:${string}`>((v) => typeof v === 'string' && v.includes(':')),
  X402_PRICE_HBAR_TINYBARS: z.coerce.bigint().positive(),
  X402_API_PORT: z.coerce.number().int().positive().default(4402),
  X402_API_URL: z.string().url().default('http://localhost:4402'),

  /** The account that receives payment. Payer is the agent's own account. */
  HEDERA_SERVICE_ACCOUNT_ID: z.string().regex(/^\d+\.\d+\.\d+$/, 'expected a Hedera id like 0.0.1234'),

  AI_PROVIDER: z.enum(['bedrock', 'fake']).default('bedrock'),
  AWS_REGION: z.string().default('us-east-1'),
  BEDROCK_API_KEY: z.string().optional(),
  BEDROCK_CHAT_MODEL: z.string().default('fake-standard'),
  BEDROCK_PREMIUM_MODEL: z.string().default('fake-premium'),
  BEDROCK_CLASSIFIER_MODEL: z.string().default('fake-fast'),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

/**
 * Parsed once, loudly.
 *
 * A missing payTo account or facilitator URL cannot be recovered from at
 * request time — the 402 would advertise payment terms nobody can satisfy —
 * so the process refuses to start rather than failing one agent at a time.
 */
export function env(): Env {
  if (cached) return cached;

  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`x402-api is misconfigured:\n${detail}`);
  }

  cached = parsed.data;
  return cached;
}
