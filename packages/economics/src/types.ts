import type {
  AIIntent,
  CommercialIntent,
  OnchainCriteria,
  OnchainMode,
  OnchainSignals,
  Persona,
} from '@aam/shared';

export interface CandidateTargeting {
  countries: string[];
  personas: string[];
  interests: string[];
  technologies: string[];
  intentCategories: string[];
  aiIntents: string[];
  models: string[];
  minCommercialIntent: CommercialIntent;
  onchainCriteria: OnchainCriteria;
  onchainMode: OnchainMode;
}

export interface CandidateCreative {
  id: string;
  headline: string;
  body: string;
  ctaText: string;
  ctaUrl: string;
  imageUrl: string | null;
}

export interface CandidateCampaign {
  campaignId: string;
  advertiserName: string;
  bidMicro: bigint;
  budgetRemainingMicro: bigint;
  /** null means no daily cap configured. */
  dailySpendRemainingMicro: bigint | null;
  startsAt: Date;
  endsAt: Date;
  frequencyCap: { perUserPerHour: number; perUserPerDay: number };
  targeting: CandidateTargeting;
  creative: CandidateCreative;
}

export interface AdUserContext {
  persona: Persona | null;
  interests: string[];
  technologies: string[];
  countryCode: string | null;
  /** 0..1; above the reward threshold the user still sees ads but earns nothing. */
  fraudScore: number;
}

export interface AdRequestContext {
  intent: AIIntent;
  user: AdUserContext;
  onchain: OnchainSignals | null;
  model: string;
  adsEnabled: boolean;
  adsOptOut: boolean;
  sessionAdCount: number;
  impressionsLastHour: Record<string, number>;
  impressionsLast24h: Record<string, number>;
  now: Date;
}

export type IneligibleReason =
  | 'ads_disabled_for_plan'
  | 'user_opted_out'
  | 'session_ad_limit'
  | 'not_started'
  | 'ended'
  | 'budget_exhausted'
  | 'daily_cap_reached'
  | 'country_excluded'
  | 'persona_excluded'
  | 'model_excluded'
  | 'commercial_intent_too_low'
  | 'frequency_cap_hour'
  | 'frequency_cap_day'
  | 'onchain_criteria_unmet'
  | 'onchain_signals_missing';

export interface ScoreBreakdown {
  intentMatch: number;
  audienceMatch: number;
  onchainMatch: number;
  bidWeight: number;
  frequencyPenalty: number;
  fraudPenalty: number;
  total: number;
}

export interface RankedCandidate {
  campaign: CandidateCampaign;
  score: ScoreBreakdown;
  /** Categorical, user-facing explanation. Never contains prompt text. */
  reasons: string[];
}

export interface EligibilityResult {
  eligible: boolean;
  reason?: IneligibleReason;
}
