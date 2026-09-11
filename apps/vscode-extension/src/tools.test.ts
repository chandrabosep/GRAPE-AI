import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { opened, setRoot } from '../test/vscode-mock';
import { applyWrite, diffSummary, runTool } from './tools';

/**
 * The tools, against a real filesystem.
 *
 * Every assertion here is about a file that actually exists or actually does
 * not. The write path especially: the whole safety story is "nothing reaches
 * disk until the developer approves it", and the only way to know that holds is
 * to propose a write and then check the disk is unchanged.
 */

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'aam-tools-'));
  setRoot(root);
  opened.length = 0;

  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.writeFile(path.join(root, 'package.json'), '{\n  "name": "demo"\n}\n');
  await fs.writeFile(
    path.join(root, 'src', 'index.ts'),
    'export function greet() {\n  return "hi";\n}\n',
  );
});

afterEach(async () => {
  setRoot(null);
  await fs.rm(root, { recursive: true, force: true });
});

describe('read_file', () => {
  it('returns the file with line numbers', async () => {
    const result = await runTool('read_file', { path: 'package.json' });
    expect(result.isError).toBe(false);
    expect(result.content).toContain('1\t{');
    expect(result.content).toContain('"name": "demo"');
  });

  it('reads a line range', async () => {
    const result = await runTool('read_file', {
      path: 'src/index.ts',
      startLine: 2,
      endLine: 2,
    });
    expect(result.content).toContain('2\t  return "hi";');
    expect(result.content).not.toContain('export function');
  });

  it('explains a missing file instead of throwing', async () => {
    const result = await runTool('read_file', { path: 'nope.ts' });
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/No file at/);
  });

  it('refuses to read outside the workspace', async () => {
    // Two gates catch this: the schema rejects the ".." segment, and the
    // resolved-path check would catch anything that slipped past it. Either
    // refusal is correct, so the assertion accepts both rather than pinning
    // which one fired.
    const result = await runTool('read_file', { path: '../../etc/passwd' });
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/outside the workspace|must not leave the workspace/);
  });
});

describe('list_directory', () => {
  it('lists the root, marking directories', async () => {
    const result = await runTool('list_directory', {});
    expect(result.isError).toBe(false);
    expect(result.content).toContain('package.json');
    expect(result.content).toContain('src/');
  });
});

describe('search_files', () => {
  it('finds a match with its line number', async () => {
    const result = await runTool('search_files', { query: 'greet' });
    expect(result.isError).toBe(false);
    expect(result.content).toMatch(/src\/index\.ts:1/);
  });

  it('reports no matches as a normal result', async () => {
    const result = await runTool('search_files', { query: 'nothinghere' });
    expect(result.isError).toBe(false);
    expect(result.content).toMatch(/No matches/);
  });
});

describe('write_file', () => {
  it('proposes a change without touching disk', async () => {
    const before = await fs.readFile(path.join(root, 'src', 'index.ts'), 'utf8');

    const result = await runTool('write_file', {
      path: 'src/index.ts',
      content: 'export function greet() {\n  return "hello";\n}\n',
    });

    expect(result.pendingWrite).toBeDefined();
    expect(result.pendingWrite!.path).toBe('src/index.ts');
    expect(result.pendingWrite!.previous).toBe(before);

    // The proposal alone must change nothing.
    const after = await fs.readFile(path.join(root, 'src', 'index.ts'), 'utf8');
    expect(after).toBe(before);
  });

  it('writes the file once the proposal is applied', async () => {
    const proposal = await runTool('write_file', {
      path: 'src/index.ts',
      content: 'export function greet() {\n  return "hello";\n}\n',
    });

    const applied = await applyWrite(proposal.pendingWrite!);
    expect(applied.isError).toBe(false);
    expect(applied.content).toMatch(/Updated "src\/index\.ts"/);

    const onDisk = await fs.readFile(path.join(root, 'src', 'index.ts'), 'utf8');
    expect(onDisk).toContain('return "hello";');

    // The change is shown, not just claimed.
    expect(opened).toHaveLength(1);
  });

  it('creates a new file, reporting it as created', async () => {
    const proposal = await runTool('write_file', {
      path: 'src/new-file.ts',
      content: 'export const x = 1;\n',
    });
    expect(proposal.pendingWrite!.previous).toBeNull();

    const applied = await applyWrite(proposal.pendingWrite!);
    expect(applied.content).toMatch(/Created "src\/new-file\.ts"/);
    expect(await fs.readFile(path.join(root, 'src', 'new-file.ts'), 'utf8')).toBe(
      'export const x = 1;\n',
    );
  });

  it('creates missing parent directories', async () => {
    // Scaffolding an app is mostly this: files in folders that do not exist
    // yet. The editor's writeFile does not do mkdirp, so the tool has to.
    const proposal = await runTool('write_file', {
      path: 'src/components/ui/Button.tsx',
      content: 'export const Button = () => null;\n',
    });

    const applied = await applyWrite(proposal.pendingWrite!);
    expect(applied.isError).toBe(false);
    expect(await fs.readFile(path.join(root, 'src/components/ui/Button.tsx'), 'utf8')).toContain(
      'Button',
    );
  });

  it('refuses to write outside the workspace, and writes nothing', async () => {
    const escape = path.join(root, '..', 'escaped.txt');

    const result = await runTool('write_file', {
      path: '../escaped.txt',
      content: 'should never exist',
    });

    expect(result.isError).toBe(true);
    expect(result.pendingWrite).toBeUndefined();
    await expect(fs.access(escape)).rejects.toThrow();
  });

  it('does not propose a write that changes nothing', async () => {
    const unchanged = await fs.readFile(path.join(root, 'package.json'), 'utf8');
    const result = await runTool('write_file', { path: 'package.json', content: unchanged });

    expect(result.pendingWrite).toBeUndefined();
    expect(result.content).toMatch(/already has exactly that content/);
  });
});

describe('diffSummary', () => {
  it('counts changed lines for an edit', () => {
    expect(
      diffSummary({ path: 'a.ts', previous: 'a\nb\nc\n', content: 'a\nB\nc\n' }),
    ).toEqual({ added: 1, removed: 1 });
  });

  it('counts a new file as all additions', () => {
    expect(diffSummary({ path: 'a.ts', previous: null, content: 'x\ny\n' })).toEqual({
      added: 3, // two lines plus the trailing empty string
      removed: 0,
    });
  });
});

describe('unknown tools', () => {
  it('are reported, not thrown', async () => {
    const result = await runTool('rm_rf', { path: '/' });
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/Unknown tool/);
  });
});
