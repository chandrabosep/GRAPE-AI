import type { ChatRequest, SponsoredAd } from '@aam/shared';
import { AppError } from '@aam/shared';
import { economics } from '../../config/index';
import { createSSEStream } from '../../lib/sse';
import { logger } from '../../lib/logger';
import { selectAd } from '../ads/service';
import { getSignalsForUser, isGraphConfigured } from '../graph/service';
import { classify, persistIntent } from '../intent/service';
import { authorizeSpend, recordUsage, touchSession } from '../usage/service';
import type { UserWithProfile } from '../users/service';
import { aiProvider, chatModel } from './provider';
import { CODING_SYSTEM_PROMPT } from './system-prompt';

/**
 * The core request lifecycle.
 *
 * Ordering here is the whole product experience. The answer starts streaming
 * immediately; intent classification and ad selection run alongside it and emit
 * the sponsored card mid-stream, so the ad appears *while* the AI is responding
 * rather than interrupting it. Nothing about ad selection is allowed to delay a
 * single token, and any failure in that path leaves the answer untouched.
 */

const DEFAULT_MAX_TOKENS = 2048;

export interface ChatContext {
  user: UserWithProfile;
  sessionId: string | null;
  requestId: string;
  adsEnabled: boolean;
  signal?: AbortSignal;
}

function buildPrompt(body: ChatRequest): { system: string; promptChars: number } {
  let system = CODING_SYSTEM_PROMPT;

  const context = body.context;
  if (context) {
    const parts: string[] = [];
    if (context.languageId) parts.push(`Language: ${context.languageId}`);
    if (context.fileName) parts.push(`File: ${context.fileName}`);
    if (context.selection) {
      parts.push(`The developer has this code selected:\n\`\`\`\n${context.selection}\n\`\`\``);
    }
    if (parts.length > 0) system += `\n\n---\n${parts.join('\n')}`;
  }

  const promptChars =
    system.length + body.messages.reduce((sum, m) => sum + m.content.length, 0);

  return { system, promptChars };
}

export function handleChat(body: ChatRequest, ctx: ChatContext): Response {
  const stream = createSSEStream(ctx.signal);

  void runChat(body, ctx, stream)
    .catch((error: unknown) => {
      const appError =
        error instanceof AppError
          ? error
          : new AppError('internal_error', 'The request could not be completed');
      logger.error({ err: error, requestId: ctx.requestId }, 'chat request failed');
      stream.send({ type: 'error', code: appError.code, message: appError.message });
    })
    .finally(() => stream.close());

  return stream.response;
}

async function runChat(
  body: ChatRequest,
  ctx: ChatContext,
  stream: ReturnType<typeof createSSEStream>,
): Promise<void> {
  const started = Date.now();
  const model = body.model ?? chatModel();
  const provider = aiProvider();

  const lastUserMessage = [...body.messages].reverse().find((m) => m.role === 'user');
  if (!lastUserMessage) {
    throw new AppError('validation_failed', 'At least one user message is required');
  }

  const { system, promptChars } = buildPrompt(body);

  // Refuse before spending anything upstream, and clamp the answer to what the
  // balance can actually pay for rather than failing mid-stream.
  const authorization = await authorizeSpend(ctx.user.id, model, promptChars, DEFAULT_MAX_TOKENS);

  stream.send({ type: 'start', requestId: ctx.requestId, model });

  const classification = classify(lastUserMessage.content, body.hints);
  stream.send({ type: 'intent', intent: classification.immediate });

  // Ads resolve alongside the answer. Deliberately not awaited here.
  const adPromise = resolveAd(body, ctx, classification, model, lastUserMessage.content);

  let adSent = false;
  const flushAd = async () => {
    if (adSent) return;
    const ad = await adPromise;
    if (ad && !stream.closed) {
      stream.send({ type: 'ad', ad });
      adSent = true;
    }
  };

  let stopReason: string | null = null;
  let usageReported = false;

  for await (const event of provider.stream({
    model,
    system,
    messages: body.messages,
    maxTokens: authorization.maxOutputTokens,
    ...(ctx.signal ? { signal: ctx.signal } : {}),
  })) {
    if (stream.closed) break;

    if (event.type === 'delta') {
      stream.send({ type: 'delta', text: event.text });
      // Once the answer is underway, slot the card in as soon as it is ready.
      if (!adSent) void flushAd();
      continue;
    }

    if (event.type === 'stop') {
      stopReason = event.reason;
      continue;
    }

    if (event.type === 'usage') {
      usageReported = true;
      const result = await recordUsage({
        userId: ctx.user.id,
        sessionId: ctx.sessionId,
        requestId: ctx.requestId,
        provider: provider.id,
        model,
        usage: event.usage,
        fundingSource: 'credits',
        latencyMs: Date.now() - started,
        stopReason,
      });

      stream.send({
        type: 'usage',
        usage: {
          inputTokens: event.usage.inputTokens,
          outputTokens: event.usage.outputTokens,
          totalTokens: event.usage.totalTokens,
          model,
          costMicro: Number(result.chargedMicro),
          fundingSource: 'credits',
          dailyTokensRemaining: 0,
          creditBalanceMicro: Number(result.balanceMicro ?? authorization.balanceMicro),
        },
      });
    }
  }

  // A card that only became ready at the very end is still worth showing.
  await flushAd();

  if (!usageReported) {
    logger.warn({ requestId: ctx.requestId }, 'provider stream ended without usage metadata');
  }
  if (ctx.sessionId) void touchSession(ctx.sessionId);

  stream.send({ type: 'done', stopReason });
}

/**
 * Resolves the sponsored card for this request.
 *
 * Waits for the refined intent because ad relevance is the entire point, but is
 * wrapped so that any failure — classification, targeting, the database — costs
 * the user nothing more than a missing card.
 */
async function resolveAd(
  body: ChatRequest,
  ctx: ChatContext,
  classification: ReturnType<typeof classify>,
  model: string,
  promptText: string,
): Promise<SponsoredAd | null> {
  if (!ctx.adsEnabled || ctx.user.profile?.adsOptOut) return null;

  try {
    const [intent, classifier] = await Promise.all([
      classification.refined,
      classification.classifier,
    ]);

    const intentId = await persistIntent({
      requestId: ctx.requestId,
      userId: ctx.user.id,
      intent,
      classifier,
      promptText,
      languageId: body.context?.languageId ?? null,
    });

    // Onchain audience signals from The Graph. Cached, so this is normally a
    // single indexed read; a miss costs one parallel fan-out. Failure yields
    // null, which correctly makes "require" campaigns ineligible rather than
    // letting them match on missing data.
    const onchain = isGraphConfigured()
      ? await getSignalsForUser(ctx.user.id).catch((error: unknown) => {
          logger.warn({ err: error, userId: ctx.user.id }, 'onchain signals unavailable');
          return null;
        })
      : null;

    return await selectAd({
      user: ctx.user,
      intent,
      onchain,
      model,
      requestId: ctx.requestId,
      intentId,
      sessionId: ctx.sessionId,
      adsEnabled: ctx.adsEnabled,
    });
  } catch (error) {
    logger.error({ err: error, requestId: ctx.requestId }, 'ad selection failed');
    return null;
  }
}

export function maxAdsPerSession(): number {
  return economics().caps.maxAdsPerSession;
}
