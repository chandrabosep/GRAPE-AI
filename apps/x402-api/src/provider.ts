import { BedrockProvider, FakeProvider, type AIProvider } from '@aam/ai-provider';
import { env } from './config';

let cached: AIProvider | null = null;

/**
 * The same provider abstraction the web gateway uses.
 *
 * Sharing it is the point: an agent paying over x402 and a developer spending
 * credits in the editor reach identical inference, so the x402 route is a
 * second way to pay for one service rather than a second service.
 */
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

export function defaultModel(): string {
  return env().AI_PROVIDER === 'fake' ? 'fake-standard' : env().BEDROCK_CHAT_MODEL;
}

/** Unknown ids fall back to the default rather than reaching the provider. */
export function resolveModel(requested: string | undefined): string {
  if (!requested) return defaultModel();
  const known = aiProvider().listModels().some((m) => m.id === requested);
  return known ? requested : defaultModel();
}

export function setAIProvider(provider: AIProvider | null): void {
  cached = provider;
}
