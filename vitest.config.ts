import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'engine',
          root: `${repoRoot}packages/engine`,
          environment: 'node',
          include: ['test/**/*.test.ts'],
          // Restarts the TestIds counters and turns test-world write validation on before each test.
          setupFiles: ['test/support/setup.ts'],
        },
      },
      // The web app keeps its test setup (jsdom, React plugin, aliases) in its own Vite config, so
      // `npm test` at the root and `npm test -w @ringside/web` run the same configuration.
      'apps/web/vite.config.ts',
      // Every tool workspace under tools/<name> brings its own vitest.config.ts. The glob names the
      // config file rather than 'tools/*' so files such as tools/README.md are not read as configs.
      'tools/*/vitest.config.ts',
    ],
    coverage: {
      provider: 'v8',
      include: ['packages/engine/src/**'],
    },
  },
});
