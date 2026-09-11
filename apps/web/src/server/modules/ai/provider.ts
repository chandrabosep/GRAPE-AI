import { BedrockProvider, FakeProvider, type AIProvider, type ModelInfo } from '@aam/ai-provider';
import { getModelPricing } from '@aam/economics';
import { economics, env } from '../../config/index';

/**
 * Chooses the AI provider once per process.
 *
 * Setting AI_PROVIDER=fake runs the entire request lifecycle — credits, intent,
 * ad selection, rewards, ledger — with no AWS credentials, no network and no
 * spend. That is what lets the rest of the system be built and demonstrated
 * before Bedrock access is sorted out, and what keeps integration tests free.
 */

let cached: AIProvider | null = null;

export function aiProvider(): AIProvider {
  if (!cached) {
    cached =
      env().AI_PROVIDER === 'fake'
        ? new FakeProvider({ delayMs: 15 })
        : new BedrockProvider({
            region: env().AWS_REGION,
            apiKey: env().BEDROCK_API_KEY,
            chatModel: env().BEDROCK_CHAT_MODEL,
            premiumModel: env().BEDROCK_PREMIUM_MODEL,
            classifierModel: env().BEDROCK_CLASSIFIER_MODEL,
          });
  }
  return cached;
}

/** Test seam: lets integration tests inject a scripted provider. */
export function setAIProvider(provider: AIProvider | null): void {
  cached = provider;
}

export function chatModel(): string {
  return env().AI_PROVIDER === 'fake' ? 'fake-standard' : env().BEDROCK_CHAT_MODEL;
}

export function classifierModel(): string {
  return env().AI_PROVIDER === 'fake' ? 'fake-fast' : env().BEDROCK_CLASSIFIER_MODEL;
}

/**
 * Narrows a client-supplied model to one this deployment actually offers.
 *
 * The model id reaches the billing path, so it cannot be taken on trust: an
 * unknown id would either fail upstream or, worse, miss the pricing table and
 * be charged as free. Anything unrecognised silently becomes the default.
 */
export function resolveModel(requested: string | undefined): string {
  if (!requested) return chatModel();
  const known = aiProvider()
    .listModels()
    .some((m) => m.id === requested);
  return known ? requested : chatModel();
}

export interface ModelChoice extends ModelInfo {
  /** Micro-USD per token, so the client can show a price without a second call. */
  inputMicroPerToken: number;
  outputMicroPerToken: number;
}

/**
 * The catalog offered to clients.
 *
 * A model with no pricing entry is withheld rather than shown: offering it
 * would let a request through that `recordUsage` then charges nothing for,
 * which is a free-inference hole, not a display bug.
 */
export function listModels(): ModelChoice[] {
  const config = economics();
  const choices: ModelChoice[] = [];

  for (const model of aiProvider().listModels()) {
    const pricing = getModelPricing(config, model.id);
    if (!pricing) continue;
    choices.push({
      ...model,
      inputMicroPerToken: pricing.inputMicroPerToken,
      outputMicroPerToken: pricing.outputMicroPerToken,
    });
  }

  return choices;
}
