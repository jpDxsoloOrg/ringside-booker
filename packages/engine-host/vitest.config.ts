import { defineConfig } from 'vitest/config';

// Not one of the root config's projects: the bundle test builds the bundle first, so it runs on its
// own with `npm test -w @ringside/engine-host` (or `npx vitest run --config packages/engine-host/vitest.config.ts`).
export default defineConfig({
  test: {
    name: 'engine-host',
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 120_000,
  },
});
