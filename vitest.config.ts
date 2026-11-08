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
      {
        test: {
          name: 'web',
          root: `${repoRoot}apps/web`,
          include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
        },
      },
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
