#!/usr/bin/env node
/**
 * Fails if any relative import carries a .js extension.
 *
 * Our workspace packages ship raw TypeScript. TypeScript, tsx and vitest all
 * happily resolve "./thing.js" to thing.ts, so this mistake typechecks and
 * passes tests — and then Turbopack refuses to resolve it and the whole app
 * 500s at runtime. Catching it here turns a confusing boot failure into a
 * one-line error.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = [
  'packages/shared/src',
  'packages/economics/src',
  'packages/ai-provider/src',
  'packages/db/src',
  'apps/web/src',
];

const PATTERN = /(?:from|import\()\s*['"](\.\.?\/[^'"]*?\.js)['"]/g;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (/\.tsx?$/.test(entry)) out.push(path);
  }
  return out;
}

const offences = [];
for (const root of ROOTS) {
  let files;
  try {
    files = walk(root);
  } catch {
    continue;
  }
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(PATTERN)) {
      const line = text.slice(0, match.index).split('\n').length;
      offences.push(`${file}:${line}  ${match[1]}`);
    }
  }
}

if (offences.length > 0) {
  console.error('Relative imports must be extensionless (Turbopack cannot resolve .js here):\n');
  for (const offence of offences) console.error(`  ${offence}`);
  console.error(`\n${offences.length} offending import(s).`);
  process.exit(1);
}

console.log('import check passed: no .js extensions on relative imports');
