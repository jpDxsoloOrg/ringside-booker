import { defineConfig } from 'vitest/config';

// Picked up by the root vitest.config.ts through its 'tools/*/vitest.config.ts' project glob, and
// used directly by `npm test -w @ringside/validate-world`.
export default defineConfig({
  test: {
    name: 'validate-world',
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
