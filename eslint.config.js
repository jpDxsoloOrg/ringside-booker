// ESLint flat config for the whole monorepo.
//
// The engine rules in docs/design/architecture.md are enforced here instead of being remembered:
// no `any`, no Math.random or wall-clock reads in the engine, no DOM or app imports in the engine.
// packages/engine/test/lint-guards.test.ts proves the guard rules fire, so an ESLint upgrade that
// changes how a selector matches fails a test instead of silently dropping a guard.

import eslintJs from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettierConfig from 'eslint-config-prettier';
import promisePlugin from 'eslint-plugin-promise';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const TYPESCRIPT_FILES = ['**/*.ts'];
const ENGINE_FILES = ['packages/engine/**/*.ts'];
const TEST_FILES = ['**/*.test.ts', 'packages/engine/test/**'];

const MATH_RANDOM_RESTRICTION = {
  object: 'Math',
  property: 'random',
  message: 'Use rng.stream(name) from core/rng. Results must be reproducible from the seed.',
};

const WALL_CLOCK_MESSAGE =
  'Game time is GameDate from core/date; the engine never reads the wall clock.';

const ENGINE_GLOBALS_MESSAGE =
  'The engine has no DOM and no browser APIs; it runs the same in Node.';

const ENGINE_IMPORT_MESSAGE =
  'Engine code has no imports from apps/ and no UI or browser storage libraries.';

const ENGINE_RESTRICTED_GLOBALS = [
  'window',
  'document',
  'navigator',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'fetch',
  'setTimeout',
  'setInterval',
  'requestAnimationFrame',
];

export default defineConfig(
  globalIgnores(['**/dist/**', '**/coverage/**', '**/*.tsbuildinfo', 'content/**']),

  // Plain JavaScript (this file and any future build scripts) runs in Node.
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    extends: [eslintJs.configs.recommended],
    languageOptions: { globals: globals.node },
  },

  // Base block: every TypeScript file gets the strictest type-checked presets.
  {
    files: TYPESCRIPT_FILES,
    extends: [
      eslintJs.configs.recommended,
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        projectService: {
          // Root-level config files such as vitest.config.ts belong to no workspace tsconfig.
          allowDefaultProject: ['*.ts'],
          defaultProject: 'tsconfig.base.json',
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-declaration-merging': 'error',
      '@typescript-eslint/no-unsafe-enum-assignment': 'error',
      '@typescript-eslint/no-unsafe-enum-comparison': 'error',
      '@typescript-eslint/no-unsafe-function-type': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unsafe-type-assertion': 'error',
      '@typescript-eslint/no-unsafe-unary-minus': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
    },
  },

  // Global rules for every linted file: async/await over .then chains, descriptive names.
  {
    plugins: { promise: promisePlugin },
    rules: {
      'promise/prefer-await-to-then': 'error',
      // Single letters are for loop indexes only. Generic type parameters (T, K) are not
      // checked by id-length, so they need no exception here.
      'id-length': ['error', { min: 2, exceptions: ['i', 'j', 'k', '_'], properties: 'never' }],
    },
  },

  // Engine-only guards: determinism and no browser or app dependencies.
  {
    files: ENGINE_FILES,
    rules: {
      'no-restricted-properties': [
        'error',
        MATH_RANDOM_RESTRICTION,
        { object: 'Date', property: 'now', message: WALL_CLOCK_MESSAGE },
        { object: 'performance', property: 'now', message: WALL_CLOCK_MESSAGE },
      ],
      'no-restricted-syntax': [
        'error',
        { selector: "NewExpression[callee.name='Date']", message: WALL_CLOCK_MESSAGE },
      ],
      'no-restricted-globals': [
        'error',
        ...ENGINE_RESTRICTED_GLOBALS.map((name) => ({ name, message: ENGINE_GLOBALS_MESSAGE })),
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'react',
                'react-dom',
                'react/*',
                '@ringside/web',
                '@ringside/web/*',
                '**/apps/**',
                'idb',
                'comlink',
              ],
              message: ENGINE_IMPORT_MESSAGE,
            },
          ],
        },
      ],
    },
  },

  // Tests may use non-null assertions on values they just set up. Everything else stays on:
  // no `any`, and engine tests keep every engine guard above.
  {
    files: TEST_FILES,
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  // Tests must be deterministic too, so tests outside the engine still may not call Math.random.
  // Engine tests are left out here because the engine block already bans it there along with
  // the wall-clock reads (a later block would replace those options, not add to them).
  {
    files: TEST_FILES,
    ignores: ENGINE_FILES,
    rules: {
      'no-restricted-properties': ['error', MATH_RANDOM_RESTRICTION],
    },
  },

  // Formatting belongs to Prettier; turn off every rule that would fight it. Keep this last.
  prettierConfig,
);
