/**
 * @vitest-environment node
 *
 * Proves that the web app's guard rules in the root eslint.config.js fire where they should.
 *
 * Same approach as packages/engine/test/lint-guards.test.ts: each case lints a snippet as if it
 * lived at a path in the repository and asserts the exact rule id, so a plugin upgrade or a
 * changed `files` glob fails here instead of a guard silently going away. The sample paths do
 * not exist on disk, so typed linting is switched off; none of these guards needs type
 * information, and the `files` globs of the real config still decide which blocks apply.
 */
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import type { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { beforeAll, describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));

const WEB_COMPONENT_PATH = 'apps/web/src/sample.tsx';
const WEB_SOURCE_PATH = 'apps/web/src/sample.ts';
const WEB_APP_SOURCE_PATH = 'apps/web/src/app/sample.ts';
const WEB_TEST_SUPPORT_PATH = 'apps/web/src/test/sample.ts';
const WEB_UNIT_TEST_PATH = 'apps/web/src/screens/sample.test.tsx';
const WEB_E2E_PATH = 'apps/web/e2e/sample.spec.ts';

const TESTING_FIXTURE_IMPORT = [
  "import { tinyWorld } from '@ringside/engine/testing';",
  'export const world = tinyWorld;',
  '',
].join('\n');

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

describe('lint guards: web app styling', () => {
  it('bans the style prop on DOM elements', async () => {
    const code = "export const Sample = () => <div style={{ color: 'red' }} />;\n";
    const messages = await lintSample(code, WEB_COMPONENT_PATH);
    const styleErrors = errorsFromRule(messages, 'react/forbid-dom-props');
    expect(styleErrors).toHaveLength(1);
    expect(styleErrors[0]?.message).toContain('Use CSS Modules and tokens');
  });

  it('bans the style prop on components', async () => {
    const code = [
      'declare function Panel(props: { style: object }): null;',
      "export const Sample = () => <Panel style={{ color: 'red' }} />;",
      '',
    ].join('\n');
    const messages = await lintSample(code, WEB_COMPONENT_PATH);
    expect(errorsFromRule(messages, 'react/forbid-component-props')).toHaveLength(1);
  });
});

describe('lint guards: web app reaches the engine through its public entry', () => {
  it('bans imports from engine source paths', async () => {
    const code = "import { x } from '@ringside/engine/src/core/rng';\nexport const used = x;\n";
    const messages = await lintSample(code, WEB_SOURCE_PATH);
    expect(errorsFromRule(messages, 'no-restricted-imports')).toHaveLength(1);
  });

  it('bans relative imports into the engine package', async () => {
    const code =
      "import { x } from '../../../packages/engine/src/index';\nexport const used = x;\n";
    const messages = await lintSample(code, WEB_SOURCE_PATH);
    expect(errorsFromRule(messages, 'no-restricted-imports')).toHaveLength(1);
  });

  it('allows the public engine entry', async () => {
    const code =
      "import { createEngine } from '@ringside/engine';\nexport const used = createEngine;\n";
    const messages = await lintSample(code, WEB_SOURCE_PATH);
    expect(errorsFromRule(messages, 'no-restricted-imports')).toHaveLength(0);
  });

  it('still bans engine source paths in web test files', async () => {
    const code = "import { x } from '@ringside/engine/src/core/rng';\nexport const used = x;\n";
    const messages = await lintSample(code, WEB_TEST_SUPPORT_PATH);
    expect(errorsFromRule(messages, 'no-restricted-imports')).toHaveLength(1);
  });
});

describe('lint guards: engine test fixtures stay out of shipped web code', () => {
  it('bans the testing entry in app source', async () => {
    const messages = await lintSample(TESTING_FIXTURE_IMPORT, WEB_APP_SOURCE_PATH);
    expect(errorsFromRule(messages, 'no-restricted-imports')).toHaveLength(1);
  });

  it.each([WEB_TEST_SUPPORT_PATH, WEB_UNIT_TEST_PATH, WEB_E2E_PATH])(
    'allows the testing entry in %s',
    async (relativePath) => {
      const messages = await lintSample(TESTING_FIXTURE_IMPORT, relativePath);
      expect(errorsFromRule(messages, 'no-restricted-imports')).toHaveLength(0);
    },
  );
});

describe('lint guards: React hooks', () => {
  it('bans a hook called inside a condition', async () => {
    const code = [
      "import { useState } from 'react';",
      'export function Sample({ open }: { open: boolean }) {',
      '  if (open) {',
      '    useState(0);',
      '  }',
      '  return null;',
      '}',
      '',
    ].join('\n');
    const messages = await lintSample(code, WEB_COMPONENT_PATH);
    expect(errorsFromRule(messages, 'react-hooks/rules-of-hooks')).toHaveLength(1);
  });

  it('reports missing effect dependencies as an error', async () => {
    const code = [
      "import { useEffect } from 'react';",
      'export function Sample({ title }: { title: string }) {',
      '  useEffect(() => {',
      '    document.title = title;',
      '  }, []);',
      '  return null;',
      '}',
      '',
    ].join('\n');
    const messages = await lintSample(code, WEB_COMPONENT_PATH);
    expect(errorsFromRule(messages, 'react-hooks/exhaustive-deps')).toHaveLength(1);
  });
});

describe('lint guards: accessibility', () => {
  it('requires alt text on images', async () => {
    const code = "export const Sample = () => <img src='/logo.png' />;\n";
    const messages = await lintSample(code, WEB_COMPONENT_PATH);
    expect(errorsFromRule(messages, 'jsx-a11y/alt-text')).toHaveLength(1);
  });
});
