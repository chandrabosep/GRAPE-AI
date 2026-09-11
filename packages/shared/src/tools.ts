import { z } from 'zod';

/**
 * The assistant's tools.
 *
 * Every one of these executes **in the editor**, never on the server. The
 * server has no access to the developer's disk and must never be given any —
 * it composes the request, streams back what the model wants to do, and the
 * extension decides whether to do it. That split is what keeps "your code stays
 * on your machine" true: file contents reach the model as part of a prompt the
 * developer's own editor assembled, and nothing is persisted server-side.
 *
 * The schemas live here rather than beside the executor because both halves
 * have to agree on them exactly — the server sends them to Bedrock as the tool
 * spec, and the extension validates the model's arguments against the same
 * shape before touching a file.
 */

export const TOOL_NAMES = [
  'read_file',
  'list_directory',
  'search_files',
  'write_file',
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

/** Tools that only observe. These run without asking. */
export const READ_ONLY_TOOLS: readonly ToolName[] = [
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
  name: ToolName;
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
