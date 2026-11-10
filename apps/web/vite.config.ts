import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { searchForWorkspaceRoot } from 'vite';
import { defineConfig } from 'vitest/config';
import packageJson from './package.json' with { type: 'json' };

const sourceDirectory = fileURLToPath(new URL('./src', import.meta.url));
/**
 * The repo's `content/` folder: the shipped data packs. The engine worker discovers them through
 * the `@content` alias with a lazy `import.meta.glob`, so pack JSON never lands in the main bundle.
 */
const contentDirectory = fileURLToPath(new URL('../../content', import.meta.url));
const engineSourceEntry = fileURLToPath(
  new URL('../../packages/engine/src/index.ts', import.meta.url),
);

/**
 * Where the app is served from. `/` locally; the GitHub Pages deploy sets `RB_BASE_PATH` to
 * `/ringside-booker/` because a project site lives under the repository name.
 */
const basePath = process.env['RB_BASE_PATH'] ?? '/';

export default defineConfig(({ command }) => ({
  base: basePath,
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^@content(?=\/|$)/, replacement: contentDirectory },
      { find: '@', replacement: sourceDirectory },
      // The dev server and tests read the engine straight from source so engine edits hot-reload.
      // Production builds go through the package entry, the same boundary the app ships with.
      // The regex matches the bare entry only, so subpath exports keep their own resolution.
      ...(command === 'serve'
        ? [{ find: /^@ringside\/engine$/, replacement: engineSourceEntry }]
        : []),
    ],
  },
  server: {
    fs: {
      // Setting `allow` replaces Vite's default, so the workspace root is listed again.
      allow: [searchForWorkspaceRoot(process.cwd()), contentDirectory],
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        /**
         * Large libraries go in their own chunks, so the main bundle stays under Vite's 500 kB
         * warning and a code change does not invalidate the cached vendor files (UI-21).
         */
        manualChunks: (id: string): string | undefined => {
          if (!id.includes('/node_modules/')) return undefined;
          if (/\/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react';
          if (/\/node_modules\/(react-router|react-router-dom|@remix-run)\//.test(id)) {
            return 'react-router';
          }
          if (id.includes('/node_modules/@radix-ui/')) return 'radix-ui';
          if (id.includes('/node_modules/@tanstack/')) return 'tanstack';
          if (id.includes('/node_modules/lucide-react/')) return 'lucide';
          return undefined;
        },
      },
    },
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
