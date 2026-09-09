import { context, build } from 'esbuild';

/**
 * Two bundles with very different constraints.
 *
 * The extension host runs in Node inside VS Code and must not bundle the
 * `vscode` module, which the editor injects. The webview runs in a browser
 * sandbox with no Node at all, so it gets its own browser-platform bundle.
 */
const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

const shared = {
  bundle: true,
  minify: production,
  sourcemap: !production,
  logLevel: 'info',
};

const configs = [
  {
    ...shared,
    entryPoints: ['src/extension.ts'],
    outfile: 'dist/extension.js',
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    external: ['vscode'],
  },
  {
    ...shared,
    entryPoints: ['webview/main.tsx'],
    outfile: 'dist/webview.js',
    platform: 'browser',
    target: 'es2022',
    format: 'iife',
  },
];

if (watch) {
  for (const config of configs) {
    const ctx = await context(config);
    await ctx.watch();
  }
  console.log('watching...');
} else {
  await Promise.all(configs.map((config) => build(config)));
}
