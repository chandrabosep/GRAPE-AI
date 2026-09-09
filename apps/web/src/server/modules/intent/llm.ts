import {
  AI_INTENTS,
  COMMERCIAL_INTENTS,
  INTENT_CATEGORIES,
  PERSONAS,
  TECHNOLOGIES,
  aiIntentSchema,
  type AIIntent,
} from '@aam/shared';
import { logger } from '../../lib/logger';
import { aiProvider, classifierModel } from '../ai/provider';

/**
 * Stage two of intent detection.
 *
 * A small fast model reads the sentence rather than matching keywords, which is
 * what separates "fix this deployment script" from "deploy this contract". It is
 * strictly best-effort: it runs against a deadline, and any failure falls back to
 * the rules stage so an answer is never delayed or blocked by classification.
 *
 * Only the user's message is sent — never the code selection. Whether code was
 * attached is a useful signal; the code itself is none of the ad engine's
 * business.
 */

const CLASSIFIER_TIMEOUT_MS = 1_500;
const MAX_INPUT_CHARS = 1_500;

const CLASSIFY_SYSTEM = `You classify a software developer's request so it can be matched to relevant developer tools.
Choose the single most specific intent that fits what they are trying to accomplish.
List only technologies actually implied by the request.
Set commercialIntent to "high" only when they are evaluating, comparing or choosing a product to adopt;
"medium" when they are integrating or deploying something; otherwise "low".
Report confidence honestly: use a low value when the request is ambiguous.`;

const INTENT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    category: { type: 'string', enum: [...INTENT_CATEGORIES] },
    intent: { type: 'string', enum: [...AI_INTENTS] },
    technologies: {
      type: 'array',
      items: { type: 'string', enum: [...TECHNOLOGIES] },
    },
    persona: { type: 'string', enum: [...PERSONAS] },
    commercialIntent: { type: 'string', enum: [...COMMERCIAL_INTENTS] },
    confidence: { type: 'number' },
  },
  required: ['category', 'intent', 'technologies', 'commercialIntent', 'confidence'],
} as const;

/** Resolves to null on timeout, error, or output that fails taxonomy validation. */
export async function classifyWithLLM(text: string): Promise<AIIntent | null> {
  const input = text.slice(0, MAX_INPUT_CHARS);

  const classification = aiProvider()
    .classify<AIIntent>({
      model: classifierModel(),
      system: CLASSIFY_SYSTEM,
      input,
      toolName: 'classify_intent',
      toolDescription: "Record the classification of the developer's request.",
      jsonSchema: INTENT_JSON_SCHEMA as unknown as Record<string, unknown>,
      maxTokens: 300,
      // Parsing through the shared schema is what guarantees the model cannot
      // introduce a value outside the taxonomy that campaigns target on.
      parse: (value) =>
        aiIntentSchema.parse({
          ...(value as Record<string, unknown>),
          persona: (value as { persona?: string }).persona ?? null,
        }),
    })
    .catch((error: unknown) => {
      logger.debug({ err: error }, 'llm intent classification failed, using rules');
      return null;
    });

  const timeout = new Promise<null>((resolve) => {
    setTimeout(() => resolve(null), CLASSIFIER_TIMEOUT_MS);
  });

  return Promise.race([classification, timeout]);
}
