import type { AIIntent, ChatMessage, ChatRequest, CreativeFormat } from '@aam/shared';
import { AppError, TOOL_SPECS, BLOCKCHAIN_TOOL_SPEC, isServerSideTool, messageText } from '@aam/shared';
import type { ClientKind } from '@aam/db';
import type { ToolSpec } from '@aam/shared';
import { economics } from '../../config/index';
import { createSSEStream } from '../../lib/sse';
import { logger } from '../../lib/logger';
import { selectAd, type AdSelection } from '../ads/service';
import { getTierStanding } from '../tiers/service';
import { executeBlockchainQuery } from '../graph/blockchain-tool';
import { getSignalsForUser, isGraphConfigured } from '../graph/service';
import { classify, persistIntent, refineIntentRecord } from '../intent/service';
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
   * the inline auction is the one that has to be fast — it has to land inside
   * the pause before the first token — and the banner is not shown until the
   * answer is finished anyway. The inline slot goes first but bids only on
   * relevance; anything unsold is left for the banner, which pays full price
   * for it.
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
  // moment it is ready rather than waiting for the first token — and its
  // auction is deliberately built not to outlast that window.
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
            result: await runServerTool(stream, call),
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
        result: await runServerTool(stream, call),
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

/**
 * Runs one server-side tool, narrating it to the client as it goes.
 *
 * A server tool is invisible by construction: the model asks for it, the server
 * answers it, and the developer sees only an answer that somehow knows the
 * price of WBTC. That is exactly the shape of a hallucination, so the call is
 * announced before it runs and closed out after — the same trail the editor
 * tools already leave, for the same reason.
 *
 * Nothing here can fail the turn. If the announcement cannot be sent the query
 * still runs; the developer loses a line of provenance, not an answer.
 */
async function runServerTool(
  stream: ReturnType<typeof createSSEStream>,
  call: { toolUseId: string; name: string; input: unknown },
): Promise<Awaited<ReturnType<typeof executeBlockchainQuery>>> {
  const input = (call.input ?? {}) as { protocol?: string; chain?: string; query?: string };
  const summary = [input.protocol ?? 'the graph', input.chain ?? 'mainnet'].join(' · ');

  if (!stream.closed) {
    stream.send({
      type: 'server_tool',
      toolUseId: call.toolUseId,
      name: call.name,
      status: 'running',
      summary,
      ...(typeof input.query === 'string' ? { query: input.query } : {}),
    });
  }

  const result = await executeBlockchainQuery(call.input);

  if (!stream.closed) {
    stream.send({
      type: 'server_tool',
      toolUseId: call.toolUseId,
      name: call.name,
      status: result.isError ? 'error' : 'done',
      summary,
      // On success the latency is the interesting part; on failure the reason
      // is, and the reason is already the whole of `content`.
      detail: result.isError
        ? firstLine(result.content)
        : result.latencyMs !== undefined
          ? `${result.latencyMs}ms`
          : undefined,
      ...(typeof input.query === 'string' ? { query: input.query } : {}),
    });
  }

  return result;
}

/** Tool errors are multi-line; a trail row has space for the first one. */
function firstLine(text: string): string {
  const line = text.split('\n', 1)[0] ?? text;
  return line.length > 160 ? `${line.slice(0, 159)}…` : line;
}

interface AdSlots {
  inline: Promise<AdSelection>;
  banner: Promise<AdSelection>;
}

/**
 * Resolves both sponsored slots for this request.
 *
 * The two slots are ranked against two different intents on purpose. The inline
 * line belongs in the pause before the first token, which is over in well under
 * a second — so it is ranked on the rules intent, which is already in hand, and
 * never waits for the classifier. The banner is not shown until the answer is
 * finished, so it can afford the classifier's deadline and gets the sharper
 * targeting for it.
 *
 * Both read one shared preparation and one shared intent record, so the second
 * slot still costs one extra ranking pass rather than a second classification
 * and a second Graph lookup. Any failure — classification, targeting, the
 * database — costs the user nothing more than a missing card.
 *
 * The order they resolve in is not the order they get to pick in: unsold
 * inventory is reserved for the banner, for the reasons set out on the inline
 * slot below.
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

  const prepared = prepareAdContext(body, ctx, classification.immediate, 'rules', model, promptText);

  /**
   * The inline line is ranked on relevance alone, and takes no remnant.
   *
   * It runs first because it has to — it belongs in the pause before the first
   * token — but running first is not the same as having first claim on the
   * inventory. An untargeted campaign is the only thing either slot can fall
   * back to, there is normally at most one of them on the books, and the inline
   * slot pays a fraction of what the banner pays for the same impression. Left
   * to take it, the cheap slot empties the shelf on every off-target question
   * and the banner — which cannot be ranked until the classifier has answered —
   * arrives to find the one campaign it could have run already spent, and
   * excluded from its auction on top of that. The turn earns a third of what it
   * should and shows the ad in the weaker of the two placements.
   *
   * So the inline slot bids only for questions an advertiser actually asked
   * for. When none did, it stays empty and the caret blinks where the line
   * would have been, and the remnant is still on the shelf when the banner
   * auction reaches it below.
   */
  const inline = prepared
    .then((context) =>
      context ? selectAd({ ...context, format: 'inline', allowRemnant: false }) : FAILED_SLOT,
    )
    .catch((error: unknown) => {
      logger.error({ err: error, requestId: ctx.requestId }, 'inline ad selection failed');
      return FAILED_SLOT;
    });

  /**
   * The same context, with the classifier's answer folded in.
   *
   * The intent row was written from the rules pass — the inline impression
   * already points at it — so the refinement updates that row instead of
   * creating a second one. The update is fire-and-forget: the banner auction
   * has no reason to wait on bookkeeping.
   */
  const refined = Promise.all([prepared, classification.refined, classification.classifier])
    .then(([context, intent, classifier]) => {
      if (!context) return null;
      const intentId = context.intentId;
      if (classifier !== 'rules' && intentId) {
        void refineIntentRecord(intentId, intent, classifier).catch((error: unknown) => {
          logger.warn({ err: error, requestId: ctx.requestId }, 'failed to refine intent record');
        });
      }
      return { ...context, intent };
    })
    .catch((error: unknown) => {
      logger.error({ err: error, requestId: ctx.requestId }, 'intent refinement failed');
      return null;
    });

  const banner = Promise.all([refined, inline])
    .then(([context, inlineSelection]) => {
      if (!context) return FAILED_SLOT;
      // Whoever took the inline slot is out of the running for the banner, so a
      // single answer never carries the same advertiser twice. On a turn no
      // campaign targeted, nobody took it — so nothing is excluded here and the
      // remnant the inline slot declined is this auction's to fill.
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

type PreparedAdContext = Omit<
  Parameters<typeof selectAd>[0],
  'format' | 'excludeAdvertiserIds' | 'allowRemnant'
>;

/**
 * The work both auctions share: record the derived intent and fetch onchain
 * signals. Doing this once is what keeps a second slot cheap.
 *
 * Nothing here waits on the classifier — the caller decides which intent to
 * prepare against — so the inline slot can be ranked in the time it takes to
 * write one row and read one cached one.
 */
async function prepareAdContext(
  body: ChatRequest,
  ctx: ChatContext,
  intent: AIIntent,
  classifier: 'rules' | 'merged',
  model: string,
  promptText: string,
): Promise<PreparedAdContext | null> {
  try {
    const [intentId, onchain, standing] = await Promise.all([
      persistIntent({
        requestId: ctx.requestId,
        userId: ctx.user.id,
        intent,
        classifier,
        promptText,
        languageId: body.context?.languageId ?? null,
      }),
      // Onchain audience signals from The Graph. Cached, so this is normally a
      // single indexed read; a miss costs one parallel fan-out. Failure yields
      // null, which correctly makes "require" campaigns ineligible rather than
      // letting them match on missing data.
      isGraphConfigured()
        ? getSignalsForUser(ctx.user.id).catch((error: unknown) => {
            logger.warn({ err: error, userId: ctx.user.id }, 'onchain signals unavailable');
            return null;
          })
        : Promise.resolve(null),
      // Resolved once for the turn and shared by both auctions, so the card and
      // the inline line quote the same rate to the same person.
      getTierStanding(ctx.user.id),
    ]);

    return {
      user: ctx.user,
      tier: standing.tier,
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
