import { z } from 'zod';
import { intentHintsSchema } from './intent.js';

/** Shared request/response contracts. The server validates with these; clients infer types from them. */

export const chatRoleSchema = z.enum(['user', 'assistant']);

export const chatMessageSchema = z.object({
  role: chatRoleSchema,
  content: z.string().min(1).max(24_000),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

/**
 * Editor context is optional and capped. It is forwarded to the model only,
 * never to the intent classifier and never persisted.
 */
export const editorContextSchema = z.object({
  languageId: z.string().max(64).optional(),
  fileName: z.string().max(300).optional(),
  workspaceName: z.string().max(200).optional(),
  selection: z.string().max(8_000).optional(),
});
export type EditorContext = z.infer<typeof editorContextSchema>;

export const chatRequestSchema = z.object({
  messages: z.array(chatMessageSchema).min(1).max(40),
  context: editorContextSchema.optional(),
  hints: intentHintsSchema.optional(),
  model: z.string().max(120).optional(),
  useCredits: z.boolean().default(true),
  sessionId: z.string().max(64).optional(),
});
export type ChatRequest = z.infer<typeof chatRequestSchema>;

export const privyLoginRequestSchema = z.object({
  privyAccessToken: z.string().min(10),
});

export const vscodeCodeRequestSchema = z.object({
  state: z.string().min(8).max(128),
});

export const vscodeExchangeRequestSchema = z.object({
  code: z.string().min(8).max(128),
  state: z.string().min(8).max(128),
});

export const sessionResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresInSeconds: z.number().int().positive(),
});
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

export const linkWalletRequestSchema = z.object({
  address: z.string().min(10).max(100),
  chainType: z.enum(['evm', 'hedera']),
  message: z.string().min(8).max(500),
  signature: z.string().min(10).max(500),
});

export const adAckRequestSchema = z.object({
  visibleMs: z.number().int().min(0).max(600_000),
});

/** Public runtime config. Drives the UI so no economics number is hardcoded client-side. */
export const publicConfigSchema = z.object({
  allocation: z.object({
    reward: z.number(),
    platform: z.number(),
    treasury: z.number(),
  }),
  plans: z.array(
    z.object({
      code: z.string(),
      name: z.string(),
      dailyTokenAllowance: z.number().int(),
      allowedModels: z.array(z.string()),
      adsEnabled: z.boolean(),
      priceMicro: z.number().int(),
    }),
  ),
  chain: z.object({
    id: z.number().int(),
    name: z.string(),
    rpcUrl: z.string(),
    explorerUrl: z.string(),
    campaignVault: z.string().nullable(),
    rewardPool: z.string().nullable(),
    usdc: z.string().nullable(),
  }),
  taxonomy: z.object({
    categories: z.array(z.string()),
    intents: z.array(z.string()),
    technologies: z.array(z.string()),
    personas: z.array(z.string()),
    interests: z.array(z.string()),
  }),
});
export type PublicConfig = z.infer<typeof publicConfigSchema>;
