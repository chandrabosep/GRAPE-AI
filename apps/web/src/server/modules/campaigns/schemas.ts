import {
  AI_INTENTS,
  COMMERCIAL_INTENTS,
  INTENT_CATEGORIES,
  INTERESTS,
  PERSONAS,
  TECHNOLOGIES,
  EMPTY_ONCHAIN_CRITERIA,
  onchainCriteriaSchema,
  onchainModeSchema,
} from '@aam/shared';
import { z } from 'zod';

/**
 * Campaign input validation.
 *
 * Targeting values are constrained to the taxonomy at the edge, so a campaign
 * can never store a value the ranking engine will not recognise, and the
 * advertiser gets a clear error instead of a campaign that silently never
 * matches anything.
 */

const microAmount = z.coerce.bigint().positive();

export const createCampaignSchema = z.object({
  name: z.string().min(3).max(120),
  budgetMicro: microAmount,
  bidMicro: microAmount,
  dailySpendCapMicro: microAmount.nullable().optional(),
  clickMultiplier: z.number().min(1).max(20).default(3),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  frequencyCap: z
    .object({
      perUserPerHour: z.number().int().min(0).max(50).default(1),
      perUserPerDay: z.number().int().min(0).max(200).default(3),
    })
    .default({ perUserPerHour: 1, perUserPerDay: 3 }),
});
export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;

export const updateCampaignSchema = createCampaignSchema.partial();

export const targetingSchema = z.object({
  countries: z.array(z.string().length(2).toUpperCase()).max(50).default([]),
  personas: z.array(z.enum(PERSONAS)).max(PERSONAS.length).default([]),
  interests: z.array(z.enum(INTERESTS)).max(INTERESTS.length).default([]),
  technologies: z.array(z.enum(TECHNOLOGIES)).max(30).default([]),
  intentCategories: z.array(z.enum(INTENT_CATEGORIES)).max(INTENT_CATEGORIES.length).default([]),
  aiIntents: z.array(z.enum(AI_INTENTS)).max(30).default([]),
  models: z.array(z.string().max(120)).max(10).default([]),
  minCommercialIntent: z.enum(COMMERCIAL_INTENTS).default('low'),
  onchainMode: onchainModeSchema.default('off'),
  onchainCriteria: onchainCriteriaSchema.default(EMPTY_ONCHAIN_CRITERIA),
});
export type TargetingInput = z.infer<typeof targetingSchema>;

export const creativeSchema = z.object({
  headline: z.string().min(5).max(90),
  body: z.string().min(10).max(240),
  ctaText: z.string().min(2).max(30),
  ctaUrl: z.url().max(500),
  imageUrl: z.url().max(500).nullable().optional(),
});
export type CreativeInput = z.infer<typeof creativeSchema>;
