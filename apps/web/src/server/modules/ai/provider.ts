import { BedrockProvider, FakeProvider, type AIProvider } from '@aam/ai-provider';
import { env } from '../../config/index';

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
