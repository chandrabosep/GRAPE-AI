import {
  COMMERCIAL_INTENT_RANK,
  INTENT_TO_CATEGORY,
  UNKNOWN_INTENT,
  type AIIntent,
  type AIIntentKind,
  type CommercialIntent,
  type IntentHints,
  type Persona,
  type Technology,
} from '@aam/shared';
import {
  HIGH_COMMERCIAL_PATTERNS,
  INTENT_RULES,
  LANGUAGE_ID_TECHNOLOGIES,
  MEDIUM_COMMERCIAL_PATTERNS,
  PERSONA_TECHNOLOGIES,
  TECHNOLOGY_ALIASES,
  TECHNOLOGY_IMPLIES,
} from './dictionaries.js';

/**
 * Stage one of intent detection: deterministic, offline, sub-millisecond.
 *
 * Runs on every request so ad selection has something to work with immediately,
 * and acts as the fallback whenever the LLM stage is slow, throttled or wrong.
 * No network, no state, no dependencies — which is also what would let this move
 * into the extension for a local-only intent mode.
 */

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Word-boundary matcher, so "go" does not match inside "google". */
function containsTerm(haystack: string, term: string): boolean {
  return new RegExp(`(?<![a-z0-9])${escapeRegExp(term)}(?![a-z0-9])`, 'i').test(haystack);
}

export function detectTechnologies(text: string, hints?: IntentHints): Technology[] {
  const found = new Set<Technology>();

  for (const [technology, aliases] of Object.entries(TECHNOLOGY_ALIASES)) {
    for (const alias of aliases ?? []) {
      if (containsTerm(text, alias)) {
        found.add(technology as Technology);
        break;
      }
    }
  }

  // The open file says as much about the stack as the prompt does.
  const languageId = hints?.languageId?.toLowerCase();
  if (languageId) {
    for (const technology of LANGUAGE_ID_TECHNOLOGIES[languageId] ?? []) found.add(technology);
  }
  if (hints?.fileExtension === '.sol') {
    found.add('solidity');
    found.add('ethereum');
  }

  // Close over implications once: naming Foundry means Solidity and Ethereum too.
  for (const technology of [...found]) {
    for (const implied of TECHNOLOGY_IMPLIES[technology] ?? []) found.add(implied);
  }

  return [...found].slice(0, 12);
}

export function inferPersona(technologies: Technology[]): Persona | null {
  let best: { persona: Persona; hits: number } | null = null;

  for (const { persona, technologies: owned } of PERSONA_TECHNOLOGIES) {
    const hits = technologies.filter((t) => owned.includes(t)).length;
    if (hits > 0 && (!best || hits > best.hits)) best = { persona, hits };
  }

  return best?.persona ?? null;
}

export function detectCommercialIntent(text: string): CommercialIntent {
  if (HIGH_COMMERCIAL_PATTERNS.some((p) => p.test(text))) return 'high';
  if (MEDIUM_COMMERCIAL_PATTERNS.some((p) => p.test(text))) return 'medium';
  return 'low';
}

interface IntentScore {
  intent: AIIntentKind;
  score: number;
}

function scoreIntents(text: string, technologies: Technology[]): IntentScore[] {
  const scores: IntentScore[] = [];

  for (const rule of INTENT_RULES) {
    if (rule.requiresAnyTechnology && !rule.requiresAnyTechnology.some((t) => technologies.includes(t))) {
      continue;
    }
    const matches = rule.patterns.filter((pattern) => pattern.test(text)).length;
    if (matches > 0) {
      scores.push({ intent: rule.intent, score: rule.weight * matches });
    }
  }

  return scores.sort((a, b) => b.score - a.score);
}

/**
 * Classifies a single user message.
 *
 * Confidence is deliberately capped below the LLM stage: these are heuristics,
 * and the ranking engine multiplies the intent term by confidence, so an
 * over-confident guess would distort the auction.
 */
export function classifyWithRules(text: string, hints?: IntentHints): AIIntent {
  const normalized = text.toLowerCase();
  const technologies = detectTechnologies(normalized, hints);
  const scores = scoreIntents(normalized, technologies);

  if (scores.length === 0) {
    // Nothing matched, but the stack and the follow-up context still carry signal.
    const persona = inferPersona(technologies);
    return {
      ...UNKNOWN_INTENT,
      intent: hints?.previousIntent ?? UNKNOWN_INTENT.intent,
      category: hints?.previousIntent
        ? INTENT_TO_CATEGORY[hints.previousIntent]
        : UNKNOWN_INTENT.category,
      technologies,
      persona,
      commercialIntent: detectCommercialIntent(normalized),
      confidence: technologies.length > 0 ? 0.3 : 0.15,
    };
  }

  const top = scores[0]!;
  const runnerUp = scores[1];

  // A clear winner is worth more than a coin flip between two rules.
  const margin = runnerUp ? (top.score - runnerUp.score) / top.score : 1;
  const confidence = Math.min(0.7, 0.35 + 0.2 * margin + 0.05 * Math.min(3, technologies.length));

  return {
    category: INTENT_TO_CATEGORY[top.intent],
    intent: top.intent,
    technologies,
    persona: inferPersona(technologies),
    commercialIntent: detectCommercialIntent(normalized),
    confidence: Number(confidence.toFixed(3)),
  };
}

/**
 * Merges the rules answer with the LLM answer.
 *
 * The LLM wins on the task itself, since it reads the sentence rather than
 * matching keywords. Technologies are unioned because each stage reliably sees
 * things the other misses, and commercial intent takes the higher of the two —
 * under-detecting it loses the advertiser a legitimately valuable impression.
 */
export function mergeIntents(rules: AIIntent, llm: AIIntent | null): AIIntent {
  if (!llm) return rules;

  const technologies = [...new Set([...llm.technologies, ...rules.technologies])].slice(0, 12);
  const commercialIntent =
    COMMERCIAL_INTENT_RANK[llm.commercialIntent] >= COMMERCIAL_INTENT_RANK[rules.commercialIntent]
      ? llm.commercialIntent
      : rules.commercialIntent;

  return {
    category: llm.category,
    intent: llm.intent,
    technologies,
    persona: llm.persona ?? rules.persona,
    commercialIntent,
    confidence: Math.max(llm.confidence, rules.confidence),
  };
}
