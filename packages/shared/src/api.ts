import { z } from 'zod';
import { intentHintsSchema } from './intent';

/** Shared request/response contracts. The server validates with these; clients infer types from them. */

export const chatRoleSchema = z.enum(['user', 'assistant']);

/**
 * One piece of a message.
 *
 * A turn used to be a string, and for ordinary chat it still reads as one. Tool
 * use forces the richer shape: the assistant's turn has to carry *which* tool it
 * asked for with which arguments, and the reply has to carry the result tied
 * back to that exact request by id. Losing either link breaks the conversation
 * for the model, not just for us.
 */
export const textBlockSchema = z.object({
  type: z.literal('text'),
  text: z.string().max(200_000),
});

export const toolUseBlockSchema = z.object({
  type: z.literal('tool_use'),
  toolUseId: z.string().min(1).max(200),
  name: z.string().min(1).max(80),
  input: z.unknown(),
});

export const toolResultBlockSchema = z.object({
  type: z.literal('tool_result'),
  toolUseId: z.string().min(1).max(200),
  /** Whatever the editor produced — file contents, a listing, or an error. */
  content: z.string().max(200_000),
  /** A failed tool still returns a result; the model needs to see why. */
  isError: z.boolean().default(false),
});

export const contentBlockSchema = z.discriminatedUnion('type', [
  textBlockSchema,
  toolUseBlockSchema,
  toolResultBlockSchema,
]);
export type ContentBlock = z.infer<typeof contentBlockSchema>;

export const chatMessageSchema = z.object({
  role: chatRoleSchema,
  /** A bare string is the ordinary case and stays legal. */
  content: z.union([
    z.string().min(1).max(24_000),
    z.array(contentBlockSchema).min(1).max(40),
  ]),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

/** Flattens a message to its plain text, ignoring tool traffic. */
export function messageText(message: ChatMessage): string {
  if (typeof message.content === 'string') return message.content;
  return message.content
    .filter((block): block is z.infer<typeof textBlockSchema> => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
}

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
  // Raised from 40: a tool-using answer spends several messages per question,
  // so the old ceiling cut conversations short after a couple of exchanges.
  messages: z.array(chatMessageSchema).min(1).max(120),
  context: editorContextSchema.optional(),
  hints: intentHintsSchema.optional(),
  model: z.string().max(120).optional(),
  useCredits: z.boolean().default(true),
  sessionId: z.string().max(64).optional(),
  /**
   * Whether the assistant may call editor tools on this request.
   *
   * Sent by the client because only the client can actually run them. A caller
   * that cannot execute tools — the x402 agent API, say — leaves this off and
   * gets a plain answer rather than a tool call it can never satisfy.
   */
  tools: z.boolean().default(false),
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
