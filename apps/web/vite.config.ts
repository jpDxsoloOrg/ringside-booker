import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import packageJson from './package.json' with { type: 'json' };

const sourceDirectory = fileURLToPath(new URL('./src', import.meta.url));
const engineSourceEntry = fileURLToPath(
  new URL('../../packages/engine/src/index.ts', import.meta.url),
);

export default defineConfig(({ command }) => ({
  plugins: [react()],
  resolve: {
    alias: [
      { find: '@', replacement: sourceDirectory },
      // The dev server and tests read the engine straight from source so engine edits hot-reload.
      // Production builds go through the package entry, the same boundary the app ships with.
      // The regex matches the bare entry only, so subpath exports keep their own resolution.
      ...(command === 'serve'
        ? [{ find: /^@ringside\/engine$/, replacement: engineSourceEntry }]
        : []),
    ],
  },
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
  },
  test: {
    name: 'web',
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['src/test/setup.ts'],
    css: {
      // Stylesheets imported as text (`?raw`) keep their text, so the gallery can read the tokens.
      include: [/\.css\?raw$/],
      // Plain class names in tests, so a test can query by class when it has to.
      modules: { classNameStrategy: 'non-scoped' },
    },
  },
}));
