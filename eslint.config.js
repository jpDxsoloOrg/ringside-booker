// ESLint flat config for the whole monorepo.
//
// The engine rules in docs/design/architecture.md are enforced here instead of being remembered:
// no `any`, no Math.random (however it is reached) or wall-clock reads in the engine, no DOM or
// app imports in the engine.
// packages/engine/test/lint-guards.test.ts proves the guard rules fire, so an ESLint upgrade that
// changes how a selector matches fails a test instead of silently dropping a guard.

import eslintJs from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettierConfig from 'eslint-config-prettier';
import jsxA11yPlugin from 'eslint-plugin-jsx-a11y';
import promisePlugin from 'eslint-plugin-promise';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const TYPESCRIPT_FILES = ['**/*.ts', '**/*.tsx'];
const ENGINE_FILES = ['packages/engine/**/*.ts'];
const TEST_FILES = ['**/*.test.ts', '**/*.test.tsx', 'packages/engine/test/**'];
const WEB_FILES = ['apps/web/**/*.{ts,tsx}'];
// Code that ships: app source and package source. It must never import the shared test fixtures.
const SHIPPED_FILES = ['apps/**', 'packages/*/src/**'];
// Test code inside those folders, which may use the fixtures: unit tests, Playwright specs, the
// Vitest setup files and the web app's test helpers (apps/web/src/test).
const FIXTURE_USER_FILES = [
  '**/*.test.ts',
  '**/*.test.tsx',
  'apps/*/e2e/**',
  'apps/*/vitest.setup.ts',
  'apps/*/src/test/**',
];
const ENGINE_SOURCE_FILES = ['packages/engine/src/**'];

const MATH_RANDOM_RESTRICTION = {
  object: 'Math',
  property: 'random',
  message: 'Use rng.stream(name) from core/rng. Results must be reproducible from the seed.',
};

const MATH_RANDOM_MESSAGE = MATH_RANDOM_RESTRICTION.message;

// no-restricted-properties only sees `Math.random` written against the bare `Math` name. These
// selectors close the ways around it in the engine:
// - through the global object: `globalThis.Math.random`, `window.Math.random`, `self['Math'].random`
// - through an alias: `const M = Math`, `const { Math: M } = globalThis`, `pass(Math)`,
//   `const M = globalThis.Math`. `Math` may only appear as the object of a member access
//   (`Math.floor`), so it can never be held in a variable where the property check can't see it.
// - through a computed key: `Math[key]`, `Math['ran' + 'dom']`. Only fixed keys can be checked, so
//   the engine never reads a property of `Math` by a key worked out at run time.
// A fixed key is a plain name (`.Math`), a string (`['Math']`) or a template with no `${}` parts.
// `owner` is the path from the matched node to the member or property that holds the key.
function fixedKey(name, { owner = '', keyField = 'property' } = {}) {
  const key = `${owner}${keyField}`;
  return (
    `:matches([${owner}computed=false][${key}.name='${name}'], [${key}.value='${name}'], ` +
    `[${key}.type='TemplateLiteral'][${key}.expressions.length=0][${key}.quasis.0.value.cooked='${name}'])`
  );
}
const NAMED_MATH = fixedKey('Math');
const NAMED_RANDOM = fixedKey('random');
const NOT_FIXED_KEY =
  ":not([property.type='Literal']):not([property.type='TemplateLiteral'][property.expressions.length=0])";
const ENGINE_MATH_RANDOM_SELECTORS = [
  // <anything>.Math.random, in dotted, bracket or template form.
  `MemberExpression${NAMED_RANDOM} > MemberExpression.object${NAMED_MATH}`,
  // <anything>.Math used as a value rather than reached through.
  `MemberExpression${NAMED_MATH}:not(MemberExpression > MemberExpression.object)`,
  // The bare Math global used as a value: assigned, passed, returned or destructured.
  "Identifier[name='Math']:not(MemberExpression > Identifier.object, MemberExpression > Identifier.property, Property > Identifier.key, TSTypeQuery > Identifier.exprName)",
  // Math destructured out of the global object: `const { Math: M } = globalThis`.
  `ObjectPattern > Property${fixedKey('Math', { keyField: 'key' })}`,
  // A property of Math (bare or through the global object) read by a key that isn't fixed.
  `MemberExpression[computed=true]${NOT_FIXED_KEY}[object.type='Identifier'][object.name='Math']`,
  `MemberExpression[computed=true]${NOT_FIXED_KEY}[object.type='MemberExpression']${fixedKey('Math', { owner: 'object.' })}`,
].map((selector) => ({ selector, message: MATH_RANDOM_MESSAGE }));

const WALL_CLOCK_MESSAGE =
  'Game time is GameDate from core/date; the engine never reads the wall clock.';

const ENGINE_GLOBALS_MESSAGE =
  'The engine has no DOM and no browser APIs; it runs the same in Node.';

const ENGINE_IMPORT_MESSAGE =
  'Engine code has no imports from apps/ and no UI or browser storage libraries.';

// The engine stays free of UI, app and browser storage dependencies.
const ENGINE_DEPENDENCY_RESTRICTION = {
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
};

const STYLE_PROP_MESSAGE = 'Use CSS Modules and tokens';

// The web app reaches the engine only through its public entry, never through engine source paths.
const ENGINE_INTERNALS_RESTRICTION = {
  group: ['@ringside/engine/src', '@ringside/engine/src/*', '**/packages/engine/**'],
  message: 'Import from the public @ringside/engine entry only.',
};

// The shared test fixtures (@ringside/engine/testing) never ship; tests and tools may use them.
const ENGINE_TESTING_RESTRICTION = {
  group: ['@ringside/engine/testing', '@ringside/engine/testing/*'],
  message: 'Test fixtures are for tests only and never ship in app or engine code.',
};

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
  globalIgnores([
    '**/dist/**',
    '**/dist-e2e/**',
    '**/coverage/**',
    '**/*.tsbuildinfo',
    'content/**',
    // Playwright's HTML report and per-test output (traces, screenshots).
    '**/playwright-report/**',
    '**/test-results/**',
  ]),

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
      // strict also reports `await pending.then(...)`, which the default lets through even though
      // it is still a .then chain.
      'promise/prefer-await-to-then': ['error', { strict: true }],
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
        ...ENGINE_MATH_RANDOM_SELECTORS,
      ],
      'no-restricted-globals': [
        'error',
        ...ENGINE_RESTRICTED_GLOBALS.map((name) => ({ name, message: ENGINE_GLOBALS_MESSAGE })),
      ],
      'no-restricted-imports': ['error', { patterns: [ENGINE_DEPENDENCY_RESTRICTION] }],
    },
  },

  // Web app: browser globals, React hook rules, accessibility, no inline styles, and the engine
  // reached only through its public entry.
  {
    files: WEB_FILES,
    extends: [jsxA11yPlugin.flatConfigs.recommended],
    plugins: { react: reactPlugin, 'react-hooks': reactHooksPlugin },
    languageOptions: { globals: globals.browser },
    settings: { react: { version: 'detect' } },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      'react/forbid-dom-props': [
        'error',
        { forbid: [{ propName: 'style', message: STYLE_PROP_MESSAGE }] },
      ],
      'react/forbid-component-props': [
        'error',
        { forbid: [{ propName: 'style', message: STYLE_PROP_MESSAGE }] },
      ],
      'no-restricted-imports': ['error', { patterns: [ENGINE_INTERNALS_RESTRICTION] }],
    },
  },

  // Shipped code never imports the shared test fixtures. Tests, Playwright specs, setup files and
  // every workspace under tools/** may. A later block replaces the no-restricted-imports options
  // of an earlier one instead of adding to them, so the two blocks after this one repeat the
  // engine and web bans for the shipped files they cover.
  {
    files: SHIPPED_FILES,
    ignores: FIXTURE_USER_FILES,
    rules: {
      'no-restricted-imports': ['error', { patterns: [ENGINE_TESTING_RESTRICTION] }],
    },
  },
  {
    files: ENGINE_SOURCE_FILES,
    ignores: FIXTURE_USER_FILES,
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [ENGINE_DEPENDENCY_RESTRICTION, ENGINE_TESTING_RESTRICTION] },
      ],
    },
  },
  {
    files: WEB_FILES,
    ignores: FIXTURE_USER_FILES,
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [ENGINE_INTERNALS_RESTRICTION, ENGINE_TESTING_RESTRICTION] },
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
