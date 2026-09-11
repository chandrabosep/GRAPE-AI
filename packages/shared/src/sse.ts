import { z } from 'zod';
import { aiIntentSchema } from './intent';

/**
 * The wire contract for POST /api/v1/ai/chat.
 *
 * The ad arrives as its own event on the same stream, never inside `delta`.
 * That separation is the product promise: the model is not asked to mention a
 * sponsor, and the client cannot render an ad as if the AI wrote it.
 */

/**
 * The two sponsored slots.
 *
 * `inline` is a single line shown beside the answer while it is still
 * streaming; `banner` is the card that follows a finished answer. Both are
 * rendered as siblings of the answer and never inside it — the format changes
 * how much room an ad takes, never whether it can be mistaken for the model.
 */
export const creativeFormatSchema = z.enum(['banner', 'inline']);
export type CreativeFormat = z.infer<typeof creativeFormatSchema>;

export const sponsoredAdSchema = z.object({
  impressionId: z.string(),
  format: creativeFormatSchema,
  headline: z.string(),
  /** Banner only. An inline ad is one line and carries no body. */
  body: z.string().nullable(),
  ctaText: z.string(),
  ctaUrl: z.string(),
  imageUrl: z.string().nullable(),
  advertiserName: z.string(),
  /** Categorical reasons shown behind "Why this ad?". Never contains prompt text. */
  reasons: z.array(z.string()).max(8),
  estimatedRewardMicro: z.number().int().nonnegative(),
});
export type SponsoredAd = z.infer<typeof sponsoredAdSchema>;

export const usageEventSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  model: z.string(),
  costMicro: z.number().int().nonnegative(),
  fundingSource: z.enum(['allowance', 'credits', 'x402']),
  dailyTokensRemaining: z.number().int(),
  creditBalanceMicro: z.number().int(),
});
export type UsageEvent = z.infer<typeof usageEventSchema>;

export const rewardEventSchema = z.object({
  impressionId: z.string(),
  amountMicro: z.number().int().nonnegative(),
  creditBalanceMicro: z.number().int().nonnegative(),
});
export type RewardEvent = z.infer<typeof rewardEventSchema>;

/**
 * Why no sponsored card was served. Coarse and about the auction, never about
 * the person: an empty slot that explains itself is the difference between a
 * working relevance floor and an apparently broken product.
 */
export const adSkippedReasonSchema = z.enum([
  'ads_disabled',
  'no_campaigns',
  'below_relevance_floor',
  'frequency_capped',
  'audience_excluded',
  'onchain_required',
  'budget_exhausted',
]);
export type AdSkippedReason = z.infer<typeof adSkippedReasonSchema>;

export const chatStreamEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('start'), requestId: z.string(), model: z.string() }),
  z.object({ type: z.literal('intent'), intent: aiIntentSchema }),
  z.object({ type: z.literal('delta'), text: z.string() }),
  z.object({ type: z.literal('ad'), ad: sponsoredAdSchema }),
  z.object({
    type: z.literal('ad_skipped'),
    format: creativeFormatSchema,
    reason: adSkippedReasonSchema,
  }),
  /**
   * The model wants to run an editor tool.
   *
   * The turn ends here: the server cannot execute anything, so it hands the
   * request to the client and stops. The client runs the tool and starts a new
   * request carrying the result, which is what makes the agent loop work over a
   * one-way stream.
   */
  z.object({
    type: z.literal('tool_use'),
    toolUseId: z.string(),
    name: z.string(),
    input: z.unknown(),
  }),
  z.object({ type: z.literal('usage'), usage: usageEventSchema }),
  z.object({ type: z.literal('reward'), reward: rewardEventSchema }),
  z.object({ type: z.literal('done'), stopReason: z.string().nullable() }),
  z.object({ type: z.literal('error'), code: z.string(), message: z.string() }),
]);
export type ChatStreamEvent = z.infer<typeof chatStreamEventSchema>;
export type ChatStreamEventType = ChatStreamEvent['type'];

/** Encodes one event as an SSE frame. The event name doubles as the `type` field. */
export function encodeSSE(event: ChatStreamEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/**
 * Incremental SSE parser for clients (VS Code extension, agent CLI).
 * Feed it decoded chunks; it returns whole events and keeps the remainder.
 */
export function createSSEParser() {
  let buffer = '';
  return {
    push(chunk: string): ChatStreamEvent[] {
      buffer += chunk;
      const events: ChatStreamEvent[] = [];
      let index: number;
      while ((index = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        for (const line of frame.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;
          try {
            events.push(JSON.parse(payload) as ChatStreamEvent);
          } catch {
            // A malformed frame must not kill an in-flight answer.
          }
        }
      }
      return events;
    },
  };
}
