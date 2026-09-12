import { randomUUID } from 'node:crypto';
import express, { type Request, type Response } from 'express';
import { decodePaymentResponseHeader } from '@x402/core/http';
import {
  HTTPFacilitatorClient,
  x402ResourceServer,
  type FacilitatorClient,
  type RouteConfig,
  type RoutesConfig,
} from '@x402/core/server';
import { paymentMiddleware } from '@x402/express';
import { ExactHederaScheme } from '@x402/hedera/exact/server';
import { z } from 'zod';
import { env } from './config';
import { HBAR_ASSET, resolveMaxTokens, toHbar, tierByPath, tiers, type Tier } from './pricing';
import { aiProvider, resolveModel } from './provider';
import { record } from './records';

const bodySchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1),
      }),
    )
    .min(1),
  model: z.string().optional(),
  maxTokens: z.number().int().positive().optional(),
});

/**
 * The 402 terms this service will accept, one entry per tier.
 *
 * `price` is given as an explicit asset/amount pair rather than a dollar
 * string: a Money string would be converted by the scheme's parser at request
 * time, which introduces an FX assumption between USD and HBAR that nobody
 * asked for. Tinybars are what actually moves, so tinybars are what is quoted.
 */
function routes(): RoutesConfig {
  const payTo = env().HEDERA_SERVICE_ACCOUNT_ID;
  const network = env().X402_NETWORK;

  const config: Record<string, RouteConfig> = {};
  for (const tier of tiers()) {
    config[`POST ${tier.path}`] = {
      accepts: {
        scheme: 'exact',
        network,
        payTo,
        price: { asset: HBAR_ASSET, amount: tier.tinybars.toString() },
      },
      description: tier.description,
      mimeType: 'application/json',
      serviceName: 'AI Attention Marketplace — inference',
      tags: ['ai', 'inference', 'llm'],
    };
  }
  return config;
}

/** The public description an agent reads before it decides to pay. */
function discovery() {
  return {
    x402Version: 2,
    service: 'AI Attention Marketplace — inference',
    description:
      'LLM inference priced per call by output-token ceiling, settled in HBAR on Hedera.',
    network: env().X402_NETWORK,
    payTo: env().HEDERA_SERVICE_ACCOUNT_ID,
    facilitator: env().X402_FACILITATOR_URL,
    resources: tiers().map((tier) => ({
      id: tier.id,
      method: 'POST',
      url: `${env().X402_API_URL}${tier.path}`,
      description: tier.description,
      maxOutputTokens: tier.maxOutputTokens,
      price: {
        scheme: 'exact',
        asset: HBAR_ASSET,
        assetName: 'HBAR',
        amount: tier.tinybars.toString(),
        amountHbar: toHbar(tier.tinybars),
      },
    })),
  };
}

/**
 * Runs the inference the agent just paid for.
 *
 * `maxTokens` is clamped to the tier rather than trusted, because the tier is
 * the thing that was priced: honouring a client-supplied 4,000 on the small
 * route would sell the large response at the small price.
 */
async function handleInference(tier: Tier, req: Request, res: Response): Promise<void> {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_request', detail: z.treeifyError(parsed.error) });
    return;
  }

  const requestId = randomUUID();
  const model = resolveModel(parsed.data.model);
  const maxTokens = resolveMaxTokens(parsed.data.maxTokens, tier);
  const startedAt = Date.now();

  const result = await aiProvider().complete({
    model,
    messages: parsed.data.messages,
    maxTokens,
  });

  const latencyMs = Date.now() - startedAt;

  // Settlement happens after this handler returns, so the transaction id only
  // exists once the response is on the wire. Read it back off the header the
  // middleware attached rather than guessing it here.
  res.on('finish', () => {
    const header =
      res.getHeader('PAYMENT-RESPONSE') ?? res.getHeader('X-PAYMENT-RESPONSE');
    if (typeof header !== 'string') return;

    let settled;
    try {
      settled = decodePaymentResponseHeader(header);
    } catch {
      return;
    }
    if (!settled.success) return;

    void record(
      {
        network: settled.network,
        txId: settled.transaction,
        payer: settled.payer ?? 'unknown',
        payTo: env().HEDERA_SERVICE_ACCOUNT_ID,
        asset: HBAR_ASSET,
        amountRaw: settled.amount ?? tier.tinybars.toString(),
        facilitator: env().X402_FACILITATOR_URL,
        requestId,
        tier: tier.id,
      },
      {
        requestId,
        provider: aiProvider().id,
        model,
        usage: result.usage,
        latencyMs,
        stopReason: result.stopReason,
      },
    );
  });

  res.json({
    text: result.text,
    usage: result.usage,
    requestId,
    model,
    tier: tier.id,
    payment: {
      network: env().X402_NETWORK,
      asset: HBAR_ASSET,
      amount: tier.tinybars.toString(),
      amountHbar: toHbar(tier.tinybars),
      // txId travels in the PAYMENT-RESPONSE header; settlement is not
      // complete until after this body is generated.
    },
  });
}

export interface AppOptions {
  /**
   * Test seam. The 402 terms cannot be built without the facilitator's
   * supported kinds, so a suite that must not touch the network supplies a
   * stub rather than skipping the paywall entirely — which would leave the
   * most important behaviour, the 402 itself, unexercised.
   */
  facilitator?: FacilitatorClient;
}

export function createApp(options: AppOptions = {}) {
  const facilitator =
    options.facilitator ?? new HTTPFacilitatorClient({ url: env().X402_FACILITATOR_URL });
  const server = new x402ResourceServer(facilitator).register(
    env().X402_NETWORK,
    new ExactHederaScheme(),
  );

  const app = express();
  app.use(express.json({ limit: '256kb' }));

  // Free endpoints, registered before the paywall so discovery costs nothing.
  app.get('/health', (_req, res) => {
    res.json({ ok: true, network: env().X402_NETWORK });
  });
  app.get('/.well-known/x402', (_req, res) => {
    res.json(discovery());
  });
  app.get('/v1/pricing', (_req, res) => {
    res.json(discovery().resources);
  });

  // Startup sync is not optional: it is where the facilitator's supported
  // kinds and fee payer come from, and without them every paid route 500s.
  app.use(paymentMiddleware(routes(), server));

  for (const tier of tiers()) {
    app.post(tier.path, (req, res, next) => {
      handleInference(tier, req, res).catch(next);
    });
  }

  app.use((error: Error, _req: Request, res: Response, _next: express.NextFunction) => {
    console.error('[x402] request failed:', error);
    if (!res.headersSent) res.status(500).json({ error: 'inference_failed' });
  });

  return app;
}

export { tierByPath };
