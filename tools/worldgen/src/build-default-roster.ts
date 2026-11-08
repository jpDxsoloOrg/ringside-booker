/**
 * `npm run worldgen:default [-- --force]`: rebuilds the default world's people, contracts, teams
 * and title reigns from `content/worlds/default/roster.spec.json` and `headliners.json`, writes
 * them into the pack, then runs the world validator and refreshes
 * `docs/design/default-world-report.md`.
 *
 * Generated files are committed and may be polished by hand. To keep a hand edit from being lost
 * by accident, the command refuses to overwrite a generated file with uncommitted changes
 * (`git diff --quiet` on the four files) unless `--force` is passed.
 *
 * Exit codes: 0 written and valid, 1 the build or the validator failed, 2 usage error or a
 * refused overwrite.
 */

import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { runValidateWorld } from '@ringside/validate-world/run';
import { buildDefaultRoster, formatSummary } from './build';
import { DEFAULT_WORLD_DIR, GENERATED_FILES, readBuildInputs } from './content';
import { renderRosterFiles, writeRosterFiles } from './output';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** Where the validator's distribution report is committed for review. */
export const REPORT_PATH = 'docs/design/default-world-report.md';

const EXIT_OK = 0;
const EXIT_FAILED = 1;
const EXIT_USAGE = 2;

const USAGE = `Usage: npm run worldgen:default [-- --force]

Rebuilds ${DEFAULT_WORLD_DIR}/{${Object.values(GENERATED_FILES).join(',')}} from roster.spec.json
and headliners.json, validates the world and writes ${REPORT_PATH}.

  --force     overwrite generated files even when they have uncommitted hand edits
  -h, --help  show this help
`;

const runFile = promisify(execFile);

/** The generated files with uncommitted changes, relative to the repository root. */
async function editedFiles(repoRoot: string): Promise<string[]> {
  const files = Object.values(GENERATED_FILES).map((file) => `${DEFAULT_WORLD_DIR}/${file}`);
  const edited: string[] = [];
  for (const file of files) {
    try {
      await runFile('git', ['diff', '--quiet', 'HEAD', '--', file], { cwd: repoRoot });
    } catch (error: unknown) {
      const code = error instanceof Error && 'code' in error ? error.code : undefined;
      if (code === 1) {
        edited.push(file);
        continue;
      }
      throw error;
    }
  }
  return edited;
}

async function main(argv: readonly string[]): Promise<number> {
  let force = false;
  try {
    const { values } = parseArgs({
      args: [...argv],
      options: {
        force: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
    });
    if (values.help) {
      process.stdout.write(USAGE);
      return EXIT_OK;
    }
    force = values.force;
  } catch (error: unknown) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
    return EXIT_USAGE;
  }

  if (!force) {
    const edited = await editedFiles(REPO_ROOT);
    if (edited.length > 0) {
      process.stderr.write(
        `These generated files have uncommitted changes:\n${edited.map((file) => `  ${file}\n`).join('')}` +
          'Commit or discard them first, or pass --force to overwrite them.\n',
      );
      return EXIT_USAGE;
    }
  }

  const build = buildDefaultRoster(await readBuildInputs(REPO_ROOT));
  await writeRosterFiles(join(REPO_ROOT, DEFAULT_WORLD_DIR), renderRosterFiles(build.files));
  process.stdout.write(formatSummary(build.summary));
  process.stdout.write(
    `\nWrote ${Object.values(GENERATED_FILES).join(', ')} to ${DEFAULT_WORLD_DIR}\n\n`,
  );

  const validation = await runValidateWorld(
    [DEFAULT_WORLD_DIR, '--strict', '--report', REPORT_PATH],
    {
      repoRoot: REPO_ROOT,
      stdout: (text) => process.stdout.write(text),
      stderr: (text) => process.stderr.write(text),
    },
  );
  return validation === 0 ? EXIT_OK : EXIT_FAILED;
}

process.exitCode = await main(process.argv.slice(2));
