import * as vscode from 'vscode';
import {
  listDirectoryInputSchema,
  readFileInputSchema,
  searchFilesInputSchema,
  writeFileInputSchema,
} from '@aam/shared';

/**
 * The assistant's tools, executed against the real workspace.
 *
 * This module is the security boundary. The model proposes a path; nothing here
 * trusts it. Every path is resolved against the workspace root and then checked
 * to still be inside it after resolution, because the only reliable way to know
 * where a path leads is to resolve it and look — string inspection alone misses
 * symlinks and normalisation quirks.
 *
 * Failures are returned, never thrown. A tool result the model can read ("that
 * file does not exist") lets it correct itself on the next turn; an exception
 * would abort an answer the developer is waiting on.
 */

/** Enough of a file to work with, without burning the context window on one read. */
const MAX_FILE_BYTES = 256 * 1024;
const MAX_READ_LINES = 2_000;
const MAX_DIRECTORY_ENTRIES = 300;
const MAX_SEARCH_RESULTS = 60;
const MAX_SEARCH_FILES = 400;

export interface ToolResult {
  content: string;
  isError: boolean;
}

const fail = (message: string): ToolResult => ({ content: message, isError: true });

/** A write the model has proposed, held until the developer decides. */
export interface PendingWrite {
  path: string;
  content: string;
  /** Null when the file does not exist yet. */
  previous: string | null;
}

export interface ToolOutcome extends ToolResult {
  /** Set when the tool needs approval before it can be applied. */
  pendingWrite?: PendingWrite;
}

function workspaceRoot(): vscode.Uri | null {
  return vscode.workspace.workspaceFolders?.[0]?.uri ?? null;
}

/**
 * Resolves a workspace-relative path, or refuses.
 *
 * The containment check runs on the resolved path rather than the input string:
 * `src/../../etc/passwd` looks fine until it is joined, and a path that leaves
 * the workspace must be refused rather than clamped back inside it — clamping
 * would silently hand the model a different file than the one it named.
 */
function resolve(root: vscode.Uri, relative: string): vscode.Uri | null {
  const cleaned = relative.replace(/^\.\/+/, '').replace(/^\/+/, '');
  const target = vscode.Uri.joinPath(root, cleaned);

  const rootPath = root.path.endsWith('/') ? root.path : `${root.path}/`;
  if (target.path !== root.path && !target.path.startsWith(rootPath)) return null;

  return target;
}

const decoder = new TextDecoder();
const encoder = new TextEncoder();

/**
 * Runs one tool call.
 *
 * Arguments are validated against the same schema the model was given, so a
 * malformed call is reported back as a readable error rather than reaching the
 * filesystem.
 */
export async function runTool(name: string, input: unknown): Promise<ToolOutcome> {
  const root = workspaceRoot();
  if (!root) return fail('No folder is open in the editor, so there are no files to read.');

  try {
    switch (name) {
      case 'read_file':
        return await readFile(root, input);
      case 'list_directory':
        return await listDirectory(root, input);
      case 'search_files':
        return await searchFiles(root, input);
      case 'write_file':
        return await prepareWrite(root, input);
      default:
        return fail(`Unknown tool "${name}".`);
    }
  } catch (error) {
    return fail(`Tool failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function readFile(root: vscode.Uri, input: unknown): Promise<ToolOutcome> {
  const parsed = readFileInputSchema.safeParse(input);
  if (!parsed.success) return fail(`Invalid arguments: ${parsed.error.issues[0]?.message}`);

  const target = resolve(root, parsed.data.path);
  if (!target) return fail('That path is outside the workspace, so it cannot be read.');

  let bytes: Uint8Array;
  try {
    bytes = await vscode.workspace.fs.readFile(target);
  } catch {
    return fail(`No file at "${parsed.data.path}". Use list_directory or search_files to find it.`);
  }

  if (bytes.byteLength > MAX_FILE_BYTES) {
    return fail(
      `"${parsed.data.path}" is ${Math.round(bytes.byteLength / 1024)}KB, too large to read at ` +
        'once. Read a line range with startLine and endLine, or search it instead.',
    );
  }

  const lines = decoder.decode(bytes).split('\n');
  const start = Math.max(1, parsed.data.startLine ?? 1);
  const end = Math.min(lines.length, parsed.data.endLine ?? lines.length);

  if (start > lines.length) {
    return fail(`"${parsed.data.path}" has only ${lines.length} lines.`);
  }

  // Truncation is announced rather than silent: a model that cannot tell it
  // received a partial file will confidently reason about code it never saw.
  const capped = Math.min(end, start + MAX_READ_LINES - 1);
  const body = lines
    .slice(start - 1, capped)
    .map((line, index) => `${start + index}\t${line}`)
    .join('\n');

  const note =
    capped < end
      ? `\n\n[Truncated at line ${capped} of ${lines.length}. Read further with startLine.]`
      : '';

  return { content: `${parsed.data.path}\n${body}${note}`, isError: false };
}

async function listDirectory(root: vscode.Uri, input: unknown): Promise<ToolOutcome> {
  const parsed = listDirectoryInputSchema.safeParse(input);
  if (!parsed.success) return fail(`Invalid arguments: ${parsed.error.issues[0]?.message}`);

  const relative = parsed.data.path.replace(/^\.$/, '');
  const target = resolve(root, relative);
  if (!target) return fail('That path is outside the workspace.');

  let entries: [string, vscode.FileType][];
  try {
    entries = await vscode.workspace.fs.readDirectory(target);
  } catch {
    return fail(`No directory at "${relative || '.'}".`);
  }

  const listed = entries
    .filter(([entryName]) => entryName !== '.git' && entryName !== 'node_modules')
    .slice(0, MAX_DIRECTORY_ENTRIES)
    .map(([entryName, kind]) =>
      kind === vscode.FileType.Directory ? `${entryName}/` : entryName,
    )
    .sort();

  const skipped = entries.length - listed.length;
  const note = skipped > 0 ? `\n[${skipped} more entries not shown.]` : '';

  return {
    content: `${relative || '.'}\n${listed.join('\n') || '(empty)'}${note}`,
    isError: false,
  };
}

async function searchFiles(root: vscode.Uri, input: unknown): Promise<ToolOutcome> {
  const parsed = searchFilesInputSchema.safeParse(input);
  if (!parsed.success) return fail(`Invalid arguments: ${parsed.error.issues[0]?.message}`);

  let matcher: RegExp;
  try {
    matcher = parsed.data.isRegex
      ? new RegExp(parsed.data.query, 'i')
      : new RegExp(parsed.data.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  } catch (error) {
    return fail(`Invalid regular expression: ${error instanceof Error ? error.message : ''}`);
  }

  const files = await vscode.workspace.findFiles(
    parsed.data.glob ?? '**/*',
    '**/{node_modules,.git,dist,build,.next,out,coverage}/**',
    MAX_SEARCH_FILES,
  );

  const hits: string[] = [];

  for (const file of files) {
    if (hits.length >= MAX_SEARCH_RESULTS) break;

    let bytes: Uint8Array;
    try {
      bytes = await vscode.workspace.fs.readFile(file);
    } catch {
      continue;
    }
    // Skip anything too big to be source, and anything binary — a NUL byte in
    // the first chunk is the cheap, reliable test.
    if (bytes.byteLength > MAX_FILE_BYTES) continue;
    if (bytes.subarray(0, 1024).includes(0)) continue;

    const relative = vscode.workspace.asRelativePath(file);
    const lines = decoder.decode(bytes).split('\n');

    for (let i = 0; i < lines.length && hits.length < MAX_SEARCH_RESULTS; i += 1) {
      const line = lines[i]!;
      if (matcher.test(line)) hits.push(`${relative}:${i + 1}: ${line.trim().slice(0, 200)}`);
    }
  }

  if (hits.length === 0) {
    return { content: `No matches for "${parsed.data.query}".`, isError: false };
  }

  const note =
    hits.length >= MAX_SEARCH_RESULTS ? '\n[Results capped. Narrow the query or glob.]' : '';

  return { content: `${hits.length} match(es):\n${hits.join('\n')}${note}`, isError: false };
}

/**
 * Prepares a write. Nothing is saved here.
 *
 * The file on disk is read first so the caller can show a real diff. Returning
 * the write as *pending* rather than applying it is what keeps the approval
 * meaningful — there is no path through this module that touches a file the
 * developer has not seen.
 */
async function prepareWrite(root: vscode.Uri, input: unknown): Promise<ToolOutcome> {
  const parsed = writeFileInputSchema.safeParse(input);
  if (!parsed.success) return fail(`Invalid arguments: ${parsed.error.issues[0]?.message}`);

  const target = resolve(root, parsed.data.path);
  if (!target) return fail('That path is outside the workspace, so it cannot be written.');

  let previous: string | null = null;
  try {
    previous = decoder.decode(await vscode.workspace.fs.readFile(target));
  } catch {
    previous = null;
  }

  if (previous === parsed.data.content) {
    return { content: `"${parsed.data.path}" already has exactly that content.`, isError: false };
  }

  return {
    content: '',
    isError: false,
    pendingWrite: { path: parsed.data.path, content: parsed.data.content, previous },
  };
}

/** Saves an approved write and opens it, so the change is visible not just claimed. */
export async function applyWrite(write: PendingWrite): Promise<ToolResult> {
  const root = workspaceRoot();
  if (!root) return fail('No folder is open in the editor.');

  const target = resolve(root, write.path);
  if (!target) return fail('That path is outside the workspace.');

  try {
    // The editor's writeFile does not create missing parents — only
    // createDirectory has mkdirp semantics. Scaffolding anything real means
    // writing into folders that do not exist yet, so the directory is made
    // first. Creating one that already exists is a no-op, so this is
    // unconditional rather than guarded by a stat.
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(target, '..'));

    await vscode.workspace.fs.writeFile(target, encoder.encode(write.content));
  } catch (error) {
    return fail(`Could not write "${write.path}": ${error instanceof Error ? error.message : ''}`);
  }

  const document = await vscode.workspace.openTextDocument(target);
  await vscode.window.showTextDocument(document, { preview: false });

  const verb = write.previous === null ? 'Created' : 'Updated';
  return { content: `${verb} "${write.path}".`, isError: false };
}

/** A minimal line diff, for showing the developer what a write would change. */
export function diffSummary(write: PendingWrite): { added: number; removed: number } {
  const before = write.previous === null ? [] : write.previous.split('\n');
  const after = write.content.split('\n');

  const beforeCounts = new Map<string, number>();
  for (const line of before) beforeCounts.set(line, (beforeCounts.get(line) ?? 0) + 1);

  let added = 0;
  for (const line of after) {
    const remaining = beforeCounts.get(line) ?? 0;
    if (remaining > 0) beforeCounts.set(line, remaining - 1);
    else added += 1;
  }

  let removed = 0;
  for (const count of beforeCounts.values()) removed += count;

  return { added, removed };
}
