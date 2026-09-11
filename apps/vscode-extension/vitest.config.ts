import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * `vscode` is injected by the editor at runtime and cannot be imported outside
 * it, so tests alias it to a mock backed by a real temp directory.
 */
export default defineConfig({
  test: { environment: 'node' },
  resolve: {
    alias: {
      vscode: fileURLToPath(new URL('./test/vscode-mock.ts', import.meta.url)),
    },
  },
});
