import { z } from 'zod';
import {
  AI_INTENTS,
  COMMERCIAL_INTENTS,
  INTENT_CATEGORIES,
  PERSONAS,
  TECHNOLOGIES,
} from './taxonomy';

/**
 * The derived signal the ad engine is allowed to see.
 *
 * This is deliberately the ONLY representation of a user's request that leaves
 * the AI gateway. There is no field here that can carry prompt text, file
 * contents or an identifier, and there is no database column for one either.
 */
export const aiIntentSchema = z.object({
  category: z.enum(INTENT_CATEGORIES),
  intent: z.enum(AI_INTENTS),
  technologies: z.array(z.enum(TECHNOLOGIES)).max(12),
  persona: z.enum(PERSONAS).nullable(),
  commercialIntent: z.enum(COMMERCIAL_INTENTS),
  /** 0..1 — how much the ranking engine should trust this classification. */
  confidence: z.number().min(0).max(1),
});
export type AIIntent = z.infer<typeof aiIntentSchema>;

export const intentClassifierSchema = z.enum(['rules', 'llm', 'merged']);
export type IntentClassifier = z.infer<typeof intentClassifierSchema>;

export const classifiedIntentSchema = aiIntentSchema.extend({
  classifier: intentClassifierSchema,
});
export type ClassifiedIntent = z.infer<typeof classifiedIntentSchema>;

/**
 * Non-prompt hints the classifier may use. `hasSelection` is a boolean on
 * purpose: whether code was attached is a useful signal, the code itself is not.
 */
export const intentHintsSchema = z.object({
  languageId: z.string().max(64).optional(),
  fileExtension: z.string().max(16).optional(),
  hasSelection: z.boolean().optional(),
  previousIntent: z.enum(AI_INTENTS).optional(),
});
export type IntentHints = z.infer<typeof intentHintsSchema>;

/** A neutral fallback so ad selection never blocks on classification failing. */
export const UNKNOWN_INTENT: AIIntent = {
  category: 'other',
  intent: 'general_coding',
  technologies: [],
  persona: null,
  commercialIntent: 'low',
  confidence: 0,
};
