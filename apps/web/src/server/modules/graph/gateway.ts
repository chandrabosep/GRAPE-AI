import { requireEnv } from '../../config/index';
import { logger } from '../../lib/logger';

/**
 * The Graph gateway client.
 *
 * One behaviour is worth stating loudly: the gateway returns **HTTP 200 with a
 * GraphQL error envelope** for auth failures, unknown subgraphs and query
 * errors alike. Checking `response.ok` alone silently treats every failure as an
 * empty result, which for an audience service means "this wallet has no
 * history" — indistinguishable from a real answer. So the body is always
 * inspected.
 */

const GATEWAY_BASE = 'https://gateway.thegraph.com/api/subgraphs/id';
const DEFAULT_TIMEOUT_MS = 2_500;

export interface GraphQLResult<T> {
  ok: boolean;
  data: T | null;
  error?: string;
  latencyMs: number;
}

export async function querySubgraph<T>(
  subgraphId: string,
  query: string,
  variables: Record<string, unknown>,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<GraphQLResult<T>> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${GATEWAY_BASE}/${subgraphId}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${requireEnv('GRAPH_GATEWAY_API_KEY')}`,
      },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });

    const latencyMs = Date.now() - started;

    if (!response.ok) {
      return { ok: false, data: null, error: `HTTP ${response.status}`, latencyMs };
    }

    const body = (await response.json()) as { data?: T; errors?: { message: string }[] };

    // A 200 carrying errors is the normal failure mode here, not an edge case.
    if (body.errors?.length) {
      const message = body.errors.map((e) => e.message).join('; ');
      logger.warn({ subgraphId, message }, 'subgraph query returned errors');
      return { ok: false, data: null, error: message, latencyMs };
    }

    return { ok: true, data: body.data ?? null, latencyMs };
  } catch (error) {
    const latencyMs = Date.now() - started;
    const message = controller.signal.aborted ? 'timeout' : String(error);
    return { ok: false, data: null, error: message, latencyMs };
  } finally {
    clearTimeout(timer);
  }
}

export interface SubgraphHealth {
  subgraphId: string;
  ok: boolean;
  blockNumber?: number;
  hasIndexingErrors?: boolean;
  error?: string;
}

/**
 * "Published and un-deprecated" is not the same as "freshly indexed". This is
 * the only way to tell the difference, and it should be run before a demo.
 */
export async function checkSubgraphHealth(subgraphId: string): Promise<SubgraphHealth> {
  const result = await querySubgraph<{
    _meta: { block: { number: number }; hasIndexingErrors: boolean };
  }>(subgraphId, '{ _meta { block { number } hasIndexingErrors } }', {}, 8_000);

  if (!result.ok || !result.data) {
    return { subgraphId, ok: false, ...(result.error ? { error: result.error } : {}) };
  }

  return {
    subgraphId,
    ok: true,
    blockNumber: result.data._meta.block.number,
    hasIndexingErrors: result.data._meta.hasIndexingErrors,
  };
}
