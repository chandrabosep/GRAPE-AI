import type { ChatMessage, ChatRequest, CreativeFormat } from '@aam/shared';
import { AppError, TOOL_SPECS, BLOCKCHAIN_TOOL_SPEC, isServerSideTool, messageText } from '@aam/shared';
import type { ClientKind } from '@aam/db';
import type { ToolSpec } from '@aam/shared';
import { economics } from '../../config/index';
import { createSSEStream } from '../../lib/sse';
import { logger } from '../../lib/logger';
import { selectAd, type AdSelection } from '../ads/service';
import { executeBlockchainQuery } from '../graph/blockchain-tool';
import { getSignalsForUser, isGraphConfigured } from '../graph/service';
import { classify, persistIntent } from '../intent/service';
import { authorizeSpend, recordUsage, resolveSession, touchSession } from '../usage/service';
import type { UserWithProfile } from '../users/service';
import { aiProvider, resolveModel } from './provider';
import { CODING_SYSTEM_PROMPT, TOOL_SYSTEM_PROMPT } from './system-prompt';

/**
 * The core request lifecycle.
 *
 * Ordering here is the whole product experience. The answer starts streaming
 * immediately; intent classification and ad selection run alongside it and emit
 * the sponsored card mid-stream, so the ad appears *while* the AI is responding
 * rather than interrupting it. Nothing about ad selection is allowed to delay a
 * single token, and any failure in that path leaves the answer untouched.
 */

/**
 * Room for an answer.
 *
 * Raised for tool use: writing a file means emitting its complete contents, and
 * the old ceiling could not hold a medium source file, so an edit arrived
 * truncated and unusable. Still clamped by what the balance can pay for.
 */
const DEFAULT_MAX_TOKENS = 4096;

export interface ChatContext {
  user: UserWithProfile;
  /** Conversation id as the client knows it, not a database id. */
  sessionId: string | null;
  client: ClientKind;
  requestId: string;
  adsEnabled: boolean;
  signal?: AbortSignal;
}

/** Characters in a message, whatever shape its content takes. */
function contentChars(content: ChatMessage['content']): number {
  if (typeof content === 'string') return content.length;
  return content.reduce((sum, block) => {
    if (block.type === 'text') return sum + block.text.length;
    if (block.type === 'tool_result') return sum + block.content.length;
    return sum + JSON.stringify(block.input ?? {}).length;
  }, 0);
}

/**
 * The last thing the developer actually typed.
 *
 * In a tool-using conversation most `user` messages are tool results the editor
 * sent on the developer's behalf. Classifying one of those would target ads at
 * the contents of a file rather than at the question, so intent always comes
 * from the last message carrying real human text.
 */
function lastHumanMessage(messages: ChatMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]!;
    if (message.role !== 'user') continue;
    const text = messageText(message).trim();
    if (text.length > 0) return text;
  }
  return null;
}

function buildPrompt(body: ChatRequest): { system: string; promptChars: number } {
  let system = CODING_SYSTEM_PROMPT;

  if (body.tools) system += `\n\n${TOOL_SYSTEM_PROMPT}`;

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
    system.length + body.messages.reduce((sum, m) => sum + contentChars(m.content), 0);

  return { system, promptChars };
}

function buildToolList(): ToolSpec[] {
  const tools: ToolSpec[] = [...TOOL_SPECS];
  if (isGraphConfigured()) tools.push(BLOCKCHAIN_TOOL_SPEC);
  return tools;
}

const MAX_SERVER_TOOL_ROUNDS = 3;

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
  // Never the raw client value: an unknown id would miss the pricing table.
  const model = resolveModel(body.model);
  const provider = aiProvider();

  const question = lastHumanMessage(body.messages);
  if (!question) {
    throw new AppError('validation_failed', 'At least one user message is required');
  }

  const { system, promptChars } = buildPrompt(body);

  // The client's conversation id is a key it invented, so it has to be resolved
  // to a real session row before anything foreign-keys to it.
  const sessionId = await resolveSession(ctx.user.id, ctx.sessionId, ctx.client, model);

  // Refuse before spending anything upstream, and clamp the answer to what the
  // balance can actually pay for rather than failing mid-stream.
  const authorization = await authorizeSpend(ctx.user.id, model, promptChars, DEFAULT_MAX_TOKENS);

  stream.send({ type: 'start', requestId: ctx.requestId, model });

  const classification = classify(question, body.hints);
  stream.send({ type: 'intent', intent: classification.immediate });

  /**
   * Both sponsored slots, resolved alongside the answer and never awaited on
   * the path that produces a token.
   *
   * The inline line and the banner card are two separate auctions, run in
   * sequence rather than together: the banner is told which campaign the inline
   * slot already took, so one advertiser cannot occupy both slots of a single
   * answer. Sequencing costs nothing that the developer can perceive, because
   * the inline auction is the one that has to be fast and the banner is not
   * shown until the answer is finished anyway.
   */
  const slots = resolveAds(body, ctx, classification, model, question);

  /**
   * Sends one slot's outcome exactly once.
   *
   * Memoising the promise rather than flipping a boolean matters twice over.
   * Every delta calls this, and a boolean checked after awaiting lets a dozen
   * callers through while the first is still waiting — a dozen identical cards.
   * But a boolean claimed *before* awaiting is worse: the end-of-stream flush
   * returns instantly instead of waiting for the in-flight send, the stream
   * closes, and the card is dropped. One shared promise gives both properties.
   */
  const flushed = new Map<CreativeFormat, Promise<void>>();
  const flushSlot = (format: CreativeFormat, pending: Promise<AdSelection>): Promise<void> => {
    let sending = flushed.get(format);
    if (!sending) {
      sending = pending.then((selection) => {
        if (stream.closed) return;
        if (selection.ad) {
          stream.send({ type: 'ad', ad: selection.ad });
        } else if (selection.reason) {
          // An empty slot that says why. Without this the client cannot tell a
          // working relevance floor from a broken ad pipeline.
          stream.send({ type: 'ad_skipped', format, reason: selection.reason });
        }
      });
      flushed.set(format, sending);
    }
    return sending;
  };

  const flushInline = () => flushSlot('inline', slots.inline);
  const flushBanner = () => flushSlot('banner', slots.banner);

  // The inline line belongs beside the thinking indicator, so it is sent the
  // moment it is ready rather than waiting for the first token.
  void flushInline();

  const allTools = body.tools ? buildToolList() : undefined;
  let currentMessages = body.messages;
  let stopReason: string | null = null;
  let usageReported = false;
  let serverToolRound = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const serverToolCalls: { toolUseId: string; name: string; input: unknown }[] = [];
    let assistantText = '';
    let hasClientTools = false;

    for await (const event of provider.stream({
      model,
      system,
      messages: currentMessages,
      maxTokens: authorization.maxOutputTokens,
      ...(allTools ? { tools: allTools } : {}),
      ...(ctx.signal ? { signal: ctx.signal } : {}),
    })) {
      if (stream.closed) break;

      if (event.type === 'tool_use') {
        if (isServerSideTool(event.name)) {
          serverToolCalls.push({
            toolUseId: event.toolUseId,
            name: event.name,
            input: event.input,
          });
        } else {
          hasClientTools = true;
          stream.send({
            type: 'tool_use',
            toolUseId: event.toolUseId,
            name: event.name,
            input: event.input,
          });
        }
        continue;
      }

      if (event.type === 'delta') {
        assistantText += event.text;
        stream.send({ type: 'delta', text: event.text });
        void flushInline();
        void flushBanner();
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
          sessionId,
          requestId: ctx.requestId,
          provider: provider.id,
          model,
          usage: event.usage,
          fundingSource: 'credits',
          latencyMs: Date.now() - started,
          stopReason,
        }).catch((error: unknown) => {
          logger.error(
            { err: error, requestId: ctx.requestId, userId: ctx.user.id },
            'failed to record usage for a delivered answer',
          );
          return null;
        });

        stream.send({
          type: 'usage',
          usage: {
            inputTokens: event.usage.inputTokens,
            outputTokens: event.usage.outputTokens,
            totalTokens: event.usage.totalTokens,
            model,
            costMicro: Number(result?.chargedMicro ?? 0n),
            fundingSource: 'credits',
            dailyTokensRemaining: 0,
            creditBalanceMicro: Number(result?.balanceMicro ?? authorization.balanceMicro),
          },
        });
      }
    }

    // No server-side tools, or client tools also present → done with this loop.
    if (serverToolCalls.length === 0 || hasClientTools || stream.closed) {
      // If there are server tool calls alongside client tools, send the results
      // so the extension can include them in the conversation history.
      if (serverToolCalls.length > 0 && hasClientTools) {
        const results = await Promise.all(
          serverToolCalls.map(async (call) => ({
            call,
            result: await executeBlockchainQuery(call.input),
          })),
        );
        for (const { call, result } of results) {
          stream.send({
            type: 'tool_result',
            toolUseId: call.toolUseId,
            name: call.name,
            content: result.content,
            isError: result.isError,
          });
        }
      }
      break;
    }

    // Only server-side tools: execute them and feed results back to the model.
    serverToolRound++;
    if (serverToolRound > MAX_SERVER_TOOL_ROUNDS) break;

    const toolResults = await Promise.all(
      serverToolCalls.map(async (call) => ({
        call,
        result: await executeBlockchainQuery(call.input),
      })),
    );

    const assistantContent: ChatMessage['content'] = [
      ...(assistantText.trim() ? [{ type: 'text' as const, text: assistantText }] : []),
      ...serverToolCalls.map((tc) => ({
        type: 'tool_use' as const,
        toolUseId: tc.toolUseId,
        name: tc.name,
        input: tc.input,
      })),
    ];

    const resultContent: ChatMessage['content'] = toolResults.map(({ call, result }) => ({
      type: 'tool_result' as const,
      toolUseId: call.toolUseId,
      content: result.content,
      isError: result.isError,
    }));

    currentMessages = [
      ...currentMessages,
      { role: 'assistant' as const, content: assistantContent },
      { role: 'user' as const, content: resultContent },
    ];
  }

  await Promise.all([flushInline(), flushBanner()]);

  if (!usageReported) {
    logger.warn({ requestId: ctx.requestId }, 'provider stream ended without usage metadata');
  }
  if (sessionId) void touchSession(sessionId);

  stream.send({ type: 'done', stopReason });
}

interface AdSlots {
  inline: Promise<AdSelection>;
  banner: Promise<AdSelection>;
}

/**
 * Resolves both sponsored slots for this request.
 *
 * Waits for the refined intent because ad relevance is the entire point, but is
 * wrapped so that any failure — classification, targeting, the database — costs
 * the user nothing more than a missing card. The shared preparation runs once
 * and both auctions read it, so adding the second slot costs one extra ranking
 * pass rather than a second classification and a second Graph lookup.
 */
function resolveAds(
  body: ChatRequest,
  ctx: ChatContext,
  classification: ReturnType<typeof classify>,
  model: string,
  promptText: string,
): AdSlots {
  if (!ctx.adsEnabled || ctx.user.profile?.adsOptOut) {
    const disabled: AdSelection = { ad: null, reason: 'ads_disabled', advertiserId: null };
    return { inline: Promise.resolve(disabled), banner: Promise.resolve(disabled) };
  }

  const prepared = prepareAdContext(body, ctx, classification, model, promptText);

  const inline = prepared
    .then((context) => (context ? selectAd({ ...context, format: 'inline' }) : FAILED_SLOT))
    .catch((error: unknown) => {
      logger.error({ err: error, requestId: ctx.requestId }, 'inline ad selection failed');
      return FAILED_SLOT;
    });

  const banner = Promise.all([prepared, inline])
    .then(([context, inlineSelection]) => {
      if (!context) return FAILED_SLOT;
      // Whoever took the inline slot is out of the running for the banner, so a
      // single answer never carries the same advertiser twice.
      const taken = inlineSelection.advertiserId;
      return selectAd({
        ...context,
        format: 'banner',
        ...(taken ? { excludeAdvertiserIds: [taken] } : {}),
      });
    })
    .catch((error: unknown) => {
      logger.error({ err: error, requestId: ctx.requestId }, 'banner ad selection failed');
      return FAILED_SLOT;
    });

  return { inline, banner };
}

/** A slot that failed for a reason the developer should not be shown. */
const FAILED_SLOT: AdSelection = { ad: null, reason: null, advertiserId: null };

type PreparedAdContext = Omit<Parameters<typeof selectAd>[0], 'format' | 'excludeAdvertiserIds'>;

/**
 * The work both auctions share: classify the question, record the derived
 * intent, and fetch onchain signals. Doing this once is what keeps a second
 * slot cheap.
 */
async function prepareAdContext(
  body: ChatRequest,
  ctx: ChatContext,
  classification: ReturnType<typeof classify>,
  model: string,
  promptText: string,
): Promise<PreparedAdContext | null> {
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

    return {
      user: ctx.user,
      intent,
      onchain,
      model,
      requestId: ctx.requestId,
      intentId,
      sessionId: ctx.sessionId,
      adsEnabled: ctx.adsEnabled,
    };
  } catch (error) {
    logger.error({ err: error, requestId: ctx.requestId }, 'ad context preparation failed');
    return null;
  }
}

export function maxAdsPerSession(): number {
  return economics().caps.maxAdsPerSession;
}
