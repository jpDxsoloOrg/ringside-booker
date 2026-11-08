/**
 * Proves that the guard rules in eslint.config.js fire where they should and only there.
 *
 * Each case lints a short snippet as if it lived at a given path in the repository and asserts the
 * exact rule id. If an ESLint or typescript-eslint upgrade changes how a selector or a `files`
 * glob matches, one of these cases fails instead of the guard silently going away.
 *
 * The sample paths do not exist on disk, and type-aware linting rejects files its TypeScript
 * projects do not know about. None of the guards needs type information, so the cases run with
 * typed linting switched off. The `files` globs of the real config still decide which blocks apply,
 * which is the part under test.
 */
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import type { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { beforeAll, describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

const ENGINE_SOURCE_PATH = 'packages/engine/src/core/sample.ts';
const ENGINE_TEST_PATH = 'packages/engine/test/sample.test.ts';
const WEB_SOURCE_PATH = 'apps/web/src/sample.ts';
const WEB_TEST_PATH = 'apps/web/src/sample.test.ts';
const TOOL_SOURCE_PATH = 'tools/sample/src/sample.ts';

let eslint: ESLint;

beforeAll(() => {
  eslint = new ESLint({
    cwd: repoRoot,
    overrideConfig: tseslint.configs.disableTypeChecked,
  });
});

async function lintSample(code: string, relativePath: string): Promise<Linter.LintMessage[]> {
  const results = await eslint.lintText(code, { filePath: `${repoRoot}${relativePath}` });
  const [result] = results;
  if (results.length !== 1 || result === undefined) {
    throw new Error(`Expected one lint result for ${relativePath}, got ${String(results.length)}`);
  }
  const fatalMessage = result.messages.find((message) => message.fatal === true);
  if (fatalMessage !== undefined) {
    throw new Error(`Sample at ${relativePath} did not parse: ${fatalMessage.message}`);
  }
  return result.messages;
}

function errorsFromRule(messages: Linter.LintMessage[], ruleId: string): Linter.LintMessage[] {
  return messages.filter((message) => message.ruleId === ruleId && message.severity === 2);
}

describe('lint guards: engine determinism', () => {
  it('bans Math.random in engine source with exactly one error', async () => {
    const messages = await lintSample('const x = Math.random();\n', ENGINE_SOURCE_PATH);
    const restrictedPropertyErrors = errorsFromRule(messages, 'no-restricted-properties');
    expect(restrictedPropertyErrors).toHaveLength(1);
    expect(restrictedPropertyErrors[0]?.message).toContain('rng.stream(name)');
  });

  it('bans Math.random in engine tests', async () => {
    const messages = await lintSample('export const roll = Math.random();\n', ENGINE_TEST_PATH);
    expect(errorsFromRule(messages, 'no-restricted-properties')).toHaveLength(1);
  });

  it('bans Math.random in tests outside the engine as well', async () => {
    const messages = await lintSample('export const roll = Math.random();\n', WEB_TEST_PATH);
    expect(errorsFromRule(messages, 'no-restricted-properties')).toHaveLength(1);
  });

  it('allows Math.random in app source outside tests', async () => {
    const messages = await lintSample('export const roll = Math.random();\n', WEB_SOURCE_PATH);
    expect(errorsFromRule(messages, 'no-restricted-properties')).toHaveLength(0);
  });

  it('bans new Date() in the engine but not in the web app', async () => {
    const code = 'const now = new Date();\n';
    const engineMessages = await lintSample(code, ENGINE_SOURCE_PATH);
    expect(errorsFromRule(engineMessages, 'no-restricted-syntax')).toHaveLength(1);

    const webMessages = await lintSample(code, WEB_SOURCE_PATH);
    expect(errorsFromRule(webMessages, 'no-restricted-syntax')).toHaveLength(0);
  });

  it('bans Date.now and performance.now in the engine', async () => {
    const code = 'export const wallClock = Date.now();\nexport const timer = performance.now();\n';
    const messages = await lintSample(code, ENGINE_SOURCE_PATH);
    expect(errorsFromRule(messages, 'no-restricted-properties')).toHaveLength(2);
  });
});

describe('lint guards: engine has no browser or app dependencies', () => {
  it('bans DOM globals in the engine', async () => {
    const messages = await lintSample("document.title = 'x';\n", ENGINE_SOURCE_PATH);
    expect(errorsFromRule(messages, 'no-restricted-globals')).toHaveLength(1);
  });

  it('bans timers in the engine', async () => {
    const messages = await lintSample('setTimeout(() => undefined, 10);\n', ENGINE_SOURCE_PATH);
    expect(errorsFromRule(messages, 'no-restricted-globals')).toHaveLength(1);
  });

  it('allows DOM globals in the web app', async () => {
    const messages = await lintSample("document.title = 'x';\n", WEB_SOURCE_PATH);
    expect(errorsFromRule(messages, 'no-restricted-globals')).toHaveLength(0);
  });

  it('bans react imports in the engine', async () => {
    const code = "import { useState } from 'react';\nexport const hook = useState;\n";
    const messages = await lintSample(code, ENGINE_SOURCE_PATH);
    expect(errorsFromRule(messages, 'no-restricted-imports')).toHaveLength(1);
  });

  it('bans relative imports that reach into apps/ from the engine', async () => {
    const code =
      "import { shell } from '../../../../apps/web/src/shell';\nexport const app = shell;\n";
    const messages = await lintSample(code, ENGINE_SOURCE_PATH);
    expect(errorsFromRule(messages, 'no-restricted-imports')).toHaveLength(1);
  });

  it('bans the web workspace package and browser storage libraries in the engine', async () => {
    const code = [
      "import { shell } from '@ringside/web';",
      "import { openDB } from 'idb';",
      "import { wrap } from 'comlink';",
      'export const used = [shell, openDB, wrap];',
      '',
    ].join('\n');
    const messages = await lintSample(code, ENGINE_SOURCE_PATH);
    expect(errorsFromRule(messages, 'no-restricted-imports')).toHaveLength(3);
  });
});

describe('lint guards: rules for every workspace', () => {
  it.each([ENGINE_SOURCE_PATH, ENGINE_TEST_PATH, WEB_SOURCE_PATH, TOOL_SOURCE_PATH])(
    'bans explicit any in %s',
    async (relativePath) => {
      const messages = await lintSample('const v: any = 1;\n', relativePath);
      expect(errorsFromRule(messages, '@typescript-eslint/no-explicit-any')).toHaveLength(1);
    },
  );

  // promise/prefer-await-to-then skips calls at the top level of a file (it predates top-level
  // await), so the snippet sits inside a function, which is where real code would have it.
  it.each([ENGINE_SOURCE_PATH, WEB_SOURCE_PATH])(
    'bans .then chains in %s',
    async (relativePath) => {
      const code = [
        'export function nextValue(pending: Promise<number>): Promise<number> {',
        '  return pending.then(() => 1);',
        '}',
        '',
      ].join('\n');
      const messages = await lintSample(code, relativePath);
      expect(errorsFromRule(messages, 'promise/prefer-await-to-then')).toHaveLength(1);
    },
  );

  it('allows non-null assertions in tests only', async () => {
    const code = 'declare const scores: number[];\nexport const first = scores[0]!;\n';
    const testMessages = await lintSample(code, ENGINE_TEST_PATH);
    expect(errorsFromRule(testMessages, '@typescript-eslint/no-non-null-assertion')).toHaveLength(
      0,
    );

    const sourceMessages = await lintSample(code, ENGINE_SOURCE_PATH);
    expect(errorsFromRule(sourceMessages, '@typescript-eslint/no-non-null-assertion')).toHaveLength(
      1,
    );
  });

  it('flags single-letter names except loop indexes and generic type parameters', async () => {
    const code = [
      'export function identity<T>(value: T): T {',
      '  return value;',
      '}',
      'export function total(values: number[]): number {',
      '  let sum = 0;',
      '  for (let i = 0; i < values.length; i += 2) sum += values[i] ?? 0;',
      '  return sum;',
      '}',
      'export const q = 1;',
      '',
    ].join('\n');
    const messages = await lintSample(code, ENGINE_SOURCE_PATH);
    const idLengthErrors = errorsFromRule(messages, 'id-length');
    expect(idLengthErrors).toHaveLength(1);
    expect(idLengthErrors[0]?.message).toContain("'q'");
  });
});
