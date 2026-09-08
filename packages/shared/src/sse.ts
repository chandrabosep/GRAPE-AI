import { z } from 'zod';
import { aiIntentSchema } from './intent.js';

/**
 * The wire contract for POST /api/v1/ai/chat.
 *
 * The ad arrives as its own event on the same stream, never inside `delta`.
 * That separation is the product promise: the model is not asked to mention a
 * sponsor, and the client cannot render an ad as if the AI wrote it.
 */

export const sponsoredAdSchema = z.object({
  impressionId: z.string(),
  headline: z.string(),
  body: z.string(),
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

export const chatStreamEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('start'), requestId: z.string(), model: z.string() }),
  z.object({ type: z.literal('intent'), intent: aiIntentSchema }),
  z.object({ type: z.literal('delta'), text: z.string() }),
  z.object({ type: z.literal('ad'), ad: sponsoredAdSchema }),
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
