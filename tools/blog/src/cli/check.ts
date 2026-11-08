import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { formatReport } from '../check/format';
import { CheckUsageError, runChecks } from '../check/run';
import type { CheckScope } from '../check/run';

// `npm run blog:check -- [--require-banned-terms] [--only blog|journal] [file...]`
// Exit codes: 0 no errors (warnings allowed), 1 at least one error, 2 bad arguments.

const USAGE = `Usage: npm run blog:check -- [--require-banned-terms] [--only blog|journal] [file...]

  file...                 check only these posts or journal files (the series index is always checked)
  --only blog|journal     check only docs/blog or only docs/dev-journal
  --require-banned-terms  fail when the private banned-terms list is missing
`;

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

function isScope(value: string): value is CheckScope {
  return value === 'blog' || value === 'journal';
}

async function main(argv: readonly string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        'require-banned-terms': { type: 'boolean', default: false },
        only: { type: 'string' },
        help: { type: 'boolean', short: 'h', default: false },
      },
    });
  } catch (error: unknown) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
    return 2;
  }
  const { values, positionals } = parsed;
  if (values.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (values.only !== undefined && !isScope(values.only)) {
    process.stderr.write(`--only must be blog or journal\n\n${USAGE}`);
    return 2;
  }

  // npm runs workspace scripts from the workspace folder; INIT_CWD is where the command was typed.
  const invokedFrom = process.env['INIT_CWD'] ?? process.cwd();
  try {
    const issues = await runChecks({
      repoRoot: REPO_ROOT,
      requireBannedTerms: values['require-banned-terms'],
      ...(values.only === undefined ? {} : { only: values.only }),
      ...(positionals.length === 0
        ? {}
        : { files: positionals.map((file) => resolve(invokedFrom, file)) }),
    });
    process.stdout.write(formatReport(issues));
    return issues.some((issue) => issue.severity === 'error') ? 1 : 0;
  } catch (error: unknown) {
    if (error instanceof CheckUsageError) {
      process.stderr.write(`${error.message}\n`);
      return 2;
    }
    throw error;
  }
}

process.exitCode = await main(process.argv.slice(2));
