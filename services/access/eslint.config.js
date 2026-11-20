// This service installs its own packages (it is not an npm workspace of the repo), so the repo's
// lint skips services/** and this config lints it: `npm run lint` here.
import eslintJs from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores(['dist/**', '.serverless/**', 'node_modules/**']),
  {
    files: ['**/*.js', '**/*.mjs'],
    extends: [eslintJs.configs.recommended],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['**/*.ts'],
    extends: [eslintJs.configs.recommended, tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
]);
