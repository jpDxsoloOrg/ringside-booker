import { defineConfig } from 'vitest/config';

// Picked up by the root vitest.config.ts through its 'tools/*/vitest.config.ts' project glob, and
// used directly by `npm test -w @ringside/tool-worldgen`.
export default defineConfig({
  test: {
    name: 'worldgen',
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // The build generates a few hundred people with full traces; give it room on slow machines.
    testTimeout: 120_000,
  },
});
