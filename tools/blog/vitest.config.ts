import { defineConfig } from 'vitest/config';

// Picked up by the root vitest.config.ts through its 'tools/*/vitest.config.ts' project glob, and
// used directly by `npm test -w @ringside/blog-tools`.
export default defineConfig({
  test: {
    name: 'blog-tools',
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
