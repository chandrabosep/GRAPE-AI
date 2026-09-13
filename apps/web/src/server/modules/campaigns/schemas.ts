import {
  AI_INTENTS,
  COMMERCIAL_INTENTS,
  INTENT_CATEGORIES,
  INTERESTS,
  PERSONAS,
  TECHNOLOGIES,
  EMPTY_ONCHAIN_CRITERIA,
  isCreativeImageRef,
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

/**
 * Creative input, validated per format.
 *
 * The two formats are not the same copy at two sizes. A banner gets a headline
 * and a body and may carry artwork; an inline creative is a single line that
 * has to sit unobtrusively beside a streaming answer, so it is capped hard and
 * has no body or image at all. Enforcing that here rather than in the UI is
 * what stops a 240-character "one-liner" reaching the chat.
 */
export const bannerCreativeSchema = z.object({
  format: z.literal('banner'),
  headline: z.string().min(5).max(90),
  body: z.string().min(10).max(240),
  ctaText: z.string().min(2).max(30),
  ctaUrl: z.url().max(500),
  /**
   * An absolute `http(s)` URL, or a root-relative path to artwork we host.
   * Deliberately not `z.url()`: that would reject the relative form and force
   * the client to resolve it against whatever origin the advertiser happened to
   * be authoring on, which is exactly the bug this replaces.
   */
  imageUrl: z
    .string()
    .max(500)
    .refine(isCreativeImageRef, {
      message: 'Must be an http(s) URL or a path beginning with "/"',
    })
    .nullable()
    .optional(),
});

export const inlineCreativeSchema = z.object({
  format: z.literal('inline'),
  /** The whole ad. One line, so it is shorter than a banner headline. */
  headline: z.string().min(5).max(70),
  ctaText: z.string().min(2).max(24),
  ctaUrl: z.url().max(500),
});

export const creativeSchema = z.discriminatedUnion('format', [
  bannerCreativeSchema,
  inlineCreativeSchema,
]);
export type CreativeInput = z.infer<typeof creativeSchema>;
