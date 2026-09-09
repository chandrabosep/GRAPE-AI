import { prisma } from '@aam/db';
import type { AIIntent, IntentHints } from '@aam/shared';
import { promptFingerprint } from '../../lib/ids';
import { classifyWithLLM } from './llm';
import { classifyWithRules, mergeIntents } from './rules';

export * from './rules';

/**
 * Two-stage intent detection.
 *
 * The rules stage answers immediately so ad selection is never the reason a
 * response is slow; the LLM stage refines it within a deadline. Callers that
 * need an answer now use `classifyFast`, and await `refine` only when they can
 * afford to.
 */

export interface ClassificationHandle {
  /** Available synchronously, good enough to rank ads against. */
  immediate: AIIntent;
  /** Resolves to the merged result, or the rules result if the LLM stage misses. */
  refined: Promise<AIIntent>;
  classifier: Promise<'rules' | 'merged'>;
}

export function classify(text: string, hints?: IntentHints): ClassificationHandle {
  const immediate = classifyWithRules(text, hints);

  const llm = classifyWithLLM(text);
  const refined = llm.then((result) => mergeIntents(immediate, result));
  const classifier = llm.then((result) => (result ? ('merged' as const) : ('rules' as const)));

  return { immediate, refined, classifier };
}

export interface PersistIntentInput {
  requestId: string;
  userId: string | null;
  intent: AIIntent;
  classifier: 'rules' | 'llm' | 'merged';
  /** Raw text, hashed here and immediately discarded. Never stored. */
  promptText: string;
  languageId?: string | null;
}

/**
 * Stores the derived intent.
 *
 * The prompt is reduced to a one-way fingerprint at this boundary and the text
 * is never written anywhere. The fingerprint exists solely so the reward engine
 * can refuse to pay for the same question asked repeatedly.
 */
export async function persistIntent(input: PersistIntentInput): Promise<string> {
  const record = await prisma.aiIntentRecord.create({
    data: {
      requestId: input.requestId,
      userId: input.userId,
      category: input.intent.category,
      intent: input.intent.intent,
      technologies: input.intent.technologies,
      persona: input.intent.persona,
      commercialIntent: input.intent.commercialIntent,
      confidence: input.intent.confidence,
      classifier: input.classifier,
      promptHash: promptFingerprint(input.promptText),
      languageId: input.languageId ?? null,
    },
    select: { id: true },
  });

  return record.id;
}

/**
 * Whether this user asked the same thing recently. Used to withhold rewards for
 * repeated prompts without blocking the answer itself.
 */
export async function isDuplicatePrompt(
  userId: string,
  promptText: string,
  windowSeconds: number,
): Promise<boolean> {
  const since = new Date(Date.now() - windowSeconds * 1000);
  const count = await prisma.aiIntentRecord.count({
    where: {
      userId,
      promptHash: promptFingerprint(promptText),
      createdAt: { gte: since },
    },
  });
  return count > 0;
}
