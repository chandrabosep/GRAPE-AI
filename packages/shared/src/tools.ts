import { z } from 'zod';

/**
 * The assistant's tools.
 *
 * Client tools execute in the editor — the server never touches the developer's
 * disk. Server tools (query_blockchain) execute on the server because they need
 * credentials (Graph API keys) the client does not have. Both are sent to the
 * model as tool specs; the execution venue is an implementation detail.
 */

export const CLIENT_TOOL_NAMES = [
  'read_file',
  'list_directory',
  'search_files',
  'write_file',
] as const;
export type ClientToolName = (typeof CLIENT_TOOL_NAMES)[number];

export const SERVER_TOOL_NAMES = ['query_blockchain'] as const;
export type ServerToolName = (typeof SERVER_TOOL_NAMES)[number];

export const TOOL_NAMES = [...CLIENT_TOOL_NAMES, ...SERVER_TOOL_NAMES] as const;
export type ToolName = ClientToolName | ServerToolName;

export function isServerSideTool(name: string): name is ServerToolName {
  return (SERVER_TOOL_NAMES as readonly string[]).includes(name);
}

/** Tools that only observe. These run without asking. */
export const READ_ONLY_TOOLS: readonly ClientToolName[] = [
  'read_file',
  'list_directory',
  'search_files',
];

export function isReadOnlyTool(name: string): boolean {
  return (READ_ONLY_TOOLS as readonly string[]).includes(name);
}

/**
 * A workspace-relative path.
 *
 * Rejected rather than sanitised: an absolute path or a `..` segment is a
 * request to leave the workspace, and quietly clamping it into bounds would
 * hand the model a file it did not ask for. Refusing says so out loud, and the
 * model corrects itself on the next turn.
 */
const relativePath = z
  .string()
  .min(1)
  .max(400)
  .refine((value) => !value.startsWith('/') && !value.startsWith('~'), {
    message: 'Path must be relative to the workspace root',
  })
  .refine((value) => !value.split(/[\\/]/).includes('..'), {
    message: 'Path must not leave the workspace',
  });

export const readFileInputSchema = z.object({
  path: relativePath,
  /** 1-based, inclusive. Omit both to read from the start. */
  startLine: z.number().int().min(1).optional(),
  endLine: z.number().int().min(1).optional(),
});

export const listDirectoryInputSchema = z.object({
  /** Empty string or "." means the workspace root. */
  path: z.string().max(400).default(''),
});

export const searchFilesInputSchema = z.object({
  query: z.string().min(1).max(200),
  /** Glob narrowing the search, e.g. "**\/*.ts". */
  glob: z.string().max(200).optional(),
  /** Substring search unless set. */
  isRegex: z.boolean().default(false),
});

export const writeFileInputSchema = z.object({
  path: relativePath,
  /** The file's complete new contents. Creates it if it does not exist. */
  content: z.string().max(400_000),
});

export const toolInputSchemas = {
  read_file: readFileInputSchema,
  list_directory: listDirectoryInputSchema,
  search_files: searchFilesInputSchema,
  write_file: writeFileInputSchema,
} as const;

/**
 * JSON Schema handed to the model.
 *
 * Written out rather than generated from the Zod schemas: the descriptions are
 * the prompt for each tool and are tuned by hand, and `additionalProperties:
 * false` everywhere is what lets the model's arguments be trusted enough to
 * validate rather than guess at.
 */
export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const TOOL_SPECS: ToolSpec[] = [
  {
    name: 'read_file',
    description:
      'Read a file from the workspace. Use this before answering any question about ' +
      'code you have not already seen, and before editing a file, so you are working ' +
      'from what is actually there rather than what you assume. Prefer reading a whole ' +
      'small file over guessing a line range.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path relative to the workspace root, e.g. "src/index.ts".',
        },
        startLine: { type: 'integer', description: 'First line to read, 1-based.' },
        endLine: { type: 'integer', description: 'Last line to read, inclusive.' },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_directory',
    description:
      'List the files and folders in one workspace directory. Use it to orient ' +
      'yourself before reading, rather than guessing at filenames.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Directory relative to the workspace root. Omit for the root.',
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: 'search_files',
    description:
      'Search the workspace for text and get back matching files with line numbers. ' +
      'This is the fastest way to find where something is defined or used. Results are ' +
      'capped, so prefer a specific query over a broad one.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Text or regular expression to find.' },
        glob: {
          type: 'string',
          description: 'Restrict to matching files, e.g. "**/*.ts".',
        },
        isRegex: {
          type: 'boolean',
          description: 'Treat the query as a regular expression. Defaults to false.',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'write_file',
    description:
      "Write a file's complete contents, creating it if needed. Read the file first " +
      'unless you are creating it. Send the entire file, not a fragment or a diff. ' +
      'The developer is shown your change and must approve it before it is saved, so ' +
      'make the edit you actually mean and explain it in your reply.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path relative to the workspace root.' },
        content: { type: 'string', description: "The file's full new contents." },
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
  },
];

export const queryBlockchainInputSchema = z.object({
  protocol: z.string().min(1).max(64),
  chain: z.string().max(32).optional(),
  query: z.string().min(1).max(4000),
  variables: z.record(z.string(), z.unknown()).optional(),
});

export const BLOCKCHAIN_TOOL_SPEC: ToolSpec = {
  name: 'query_blockchain',
  description:
    'Query live blockchain data from The Graph protocol. Executes a GraphQL query ' +
    'against a Messari standardized subgraph and returns JSON. Use this when the ' +
    'developer asks about DeFi protocols, token stats, on-chain activity, or ENS.\n\n' +
    'Protocols (lending): aave-v3 (mainnet/arbitrum-one/base), aave-v2 (mainnet), ' +
    'compound-v3 (mainnet), compound-v2 (mainnet)\n' +
    'Protocols (DEX): uniswap-v3 (mainnet/arbitrum-one/base), uniswap-v2 (mainnet), ' +
    'sushiswap-v3 (mainnet/arbitrum-one), balancer-v2 (mainnet), curve (mainnet)\n' +
    'Other: ens (mainnet)\n\n' +
    'Lending entities: protocols, markets, deposits, borrows, repays, withdraws, ' +
    'financialsDailySnapshots, usageMetricsDailySnapshots\n' +
    'DEX entities: protocols, liquidityPools, swaps, financialsDailySnapshots, ' +
    'usageMetricsDailySnapshots\n' +
    'ENS entities: domains, registrations\n\n' +
    'Addresses must be lowercase. Timestamps are BigInt strings (Unix seconds). ' +
    'Request first: 1–10 for lists. All amounts are in wei or the token\'s smallest unit.',
  inputSchema: {
    type: 'object',
    properties: {
      protocol: {
        type: 'string',
        description: 'Protocol slug, e.g. "aave-v3", "uniswap-v3", "ens".',
      },
      chain: {
        type: 'string',
        description: 'Chain: "mainnet" (default), "arbitrum-one", or "base".',
      },
      query: {
        type: 'string',
        description: 'GraphQL query to execute against the subgraph.',
      },
      variables: {
        type: 'object',
        description: 'GraphQL query variables.',
      },
    },
    required: ['protocol', 'query'],
    additionalProperties: false,
  },
};
