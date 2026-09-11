#!/usr/bin/env node
/**
 * Builds, packages and installs the extension into the running editor.
 *
 * `pnpm build` only refreshes `dist/`, which is what the F5 development host
 * reads. An extension installed from a .vsix is a *separate copy* under the
 * editor's extensions directory and keeps running whatever it was installed
 * with — so after changing extension code, a normally-installed editor silently
 * keeps serving the old build. That failure mode looks exactly like the feature
 * never having been built, which is confusing enough to be worth one command.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit', cwd: root });

run('npx', ['--no-install', 'vsce', 'package', '--no-dependencies']);

const VSIX = 'ai-attention-marketplace-0.1.0.vsix';
if (!existsSync(new URL(`../${VSIX}`, import.meta.url))) {
  console.error(`Expected ${VSIX} after packaging, but it is not there.`);
  process.exit(1);
}

/** Whichever editors are actually installed. A missing one is skipped, not fatal. */
const editors = ['cursor', 'code', 'code-insiders', 'windsurf'].filter((cli) => {
  try {
    execFileSync('which', [cli], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
});

if (editors.length === 0) {
  console.error('No editor CLI on PATH. Install the .vsix by hand, or press F5 instead.');
  process.exit(1);
}

for (const cli of editors) {
  console.log(`\nInstalling into ${cli}...`);
  run(cli, ['--install-extension', VSIX, '--force']);
}

console.log('\nDone. Reload the editor window (Developer: Reload Window) to load it.');
