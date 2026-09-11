import { describe, expect, it } from 'vitest';
import {
  isReadOnlyTool,
  listDirectoryInputSchema,
  readFileInputSchema,
  TOOL_SPECS,
  writeFileInputSchema,
} from './tools';

/**
 * The path rules are the security boundary for editor tools, so they are
 * asserted rather than assumed. Everything here is a path the model could
 * plausibly produce — not contrived attacks, but the shapes an LLM actually
 * emits when it is confused about where the workspace root is.
 */

describe('tool path validation', () => {
  const escapes = [
    '../secrets.env',
    'src/../../etc/passwd',
    '/etc/passwd',
    '~/.ssh/id_rsa',
    'a/b/../../../outside.txt',
  ];

  it.each(escapes)('refuses %s for reads', (path) => {
    expect(readFileInputSchema.safeParse({ path }).success).toBe(false);
  });

  it.each(escapes)('refuses %s for writes', (path) => {
    expect(writeFileInputSchema.safeParse({ path, content: 'x' }).success).toBe(false);
  });

  it('accepts ordinary workspace paths', () => {
    for (const path of ['package.json', 'src/index.ts', 'apps/web/src/app/page.tsx']) {
      expect(readFileInputSchema.safeParse({ path }).success).toBe(true);
    }
  });

  it('treats a file merely named ".." -prefixed as ordinary', () => {
    // "..foo" is a real filename, not a traversal; only a whole ".." segment is.
    expect(readFileInputSchema.safeParse({ path: '..eslintrc' }).success).toBe(true);
  });

  it('defaults an omitted directory to the workspace root', () => {
    const parsed = listDirectoryInputSchema.parse({});
    expect(parsed.path).toBe('');
  });
});

describe('tool specs', () => {
  it('closes every schema to unknown properties', () => {
    // Without this the model can smuggle arguments past validation, and a
    // "strict" tool call stops meaning anything.
    for (const spec of TOOL_SPECS) {
      expect(spec.inputSchema.additionalProperties).toBe(false);
    }
  });

  it('classifies exactly one tool as mutating', () => {
    const mutating = TOOL_SPECS.filter((spec) => !isReadOnlyTool(spec.name));
    expect(mutating.map((spec) => spec.name)).toEqual(['write_file']);
  });
});
