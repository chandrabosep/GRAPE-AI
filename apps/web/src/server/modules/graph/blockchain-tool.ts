import { queryBlockchainInputSchema } from '@aam/shared';
import { querySubgraph } from './gateway';
import { findSubgraphId, knownProtocols } from './sources';

/**
 * Executes the `query_blockchain` server-side tool.
 *
 * The model writes a GraphQL query targeting a protocol slug; this resolves the
 * slug to a deployment ID and runs it against the Graph gateway. The result
 * comes back as a JSON string for the model to interpret.
 *
 * Safety:
 * - Only protocols in the registry are reachable.
 * - Response is truncated to avoid blowing up context.
 * - Timeout is 5 s (generous for a subgraph query).
 */

const MAX_RESULT_CHARS = 8_000;

export interface ToolResult {
  content: string;
  isError: boolean;
  /** Round trip to the gateway, for the client to show beside the call. */
  latencyMs?: number;
}

export async function executeBlockchainQuery(input: unknown): Promise<ToolResult> {
  const parsed = queryBlockchainInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      content: `Invalid input: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
      isError: true,
    };
  }

  const { protocol, query, variables } = parsed.data;
  const chain = parsed.data.chain ?? 'mainnet';

  const match = findSubgraphId(protocol, chain);
  if (!match) {
    return {
      content:
        `Unknown protocol "${protocol}" on chain "${chain}". ` +
        `Available protocols: ${knownProtocols().join(', ')}`,
      isError: true,
    };
  }

  const result = await querySubgraph(
    match.subgraphId,
    query,
    variables ?? {},
    5_000,
  );

  if (!result.ok || result.data === null) {
    return {
      content: `Graph query failed: ${result.error ?? 'unknown error'} (${result.latencyMs}ms)`,
      isError: true,
      latencyMs: result.latencyMs,
    };
  }

  let json = JSON.stringify(result.data, null, 2);
  if (json.length > MAX_RESULT_CHARS) {
    json = json.slice(0, MAX_RESULT_CHARS) + '\n... (truncated)';
  }

  return {
    content: `[${protocol}/${chain}, ${result.latencyMs}ms]\n${json}`,
    isError: false,
    latencyMs: result.latencyMs,
  };
}
