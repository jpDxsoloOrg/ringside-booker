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
        },
      },
      // Paths are absolute so the config works from a workspace too (`npm run test -w
      // @ringside/engine` runs vitest with the engine package as its working directory).
      // The web app keeps its test setup (jsdom, React plugin, aliases) in its own Vite config, so
      // `npm test` at the root and `npm test -w @ringside/web` run the same configuration.
      `${repoRoot}apps/web/vite.config.ts`,
      // Every tool workspace under tools/<name> brings its own vitest.config.ts. The glob names the
      // config file rather than 'tools/*' so files such as tools/README.md are not read as configs.
      `${repoRoot}tools/*/vitest.config.ts`,
    ],
    coverage: {
      provider: 'v8',
      include: ['packages/engine/src/**'],
    },
  },
});
