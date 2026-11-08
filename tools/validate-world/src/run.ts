/**
 * The `validate-world` command: read packs, load them through the engine loader, run the content
 * rules and the real-name blocklist, and print the distribution report.
 *
 * Exit codes: 0 valid (warnings allowed unless `--strict`), 1 content errors (or warnings under
 * `--strict`, or a failed smoke run), 2 usage or I/O errors (bad arguments, a missing pack folder,
 * a missing or empty blocklist, a report file that cannot be written).
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  loadWorldFromPacks,
  packs,
  type LoadedWorld,
  type MergedContent,
  type RawPack,
} from '@ringside/engine';
import { BlocklistError, COMMITTED_BLOCKLIST_PATH, loadBlocklist } from './blocklist';
import {
  compareValidationIssues,
  countBySeverity,
  formatIssue,
  type ValidationIssue,
} from './issues';
import { displayPath, PackDirectoryError, readPacks } from './readPacks';
import { buildReport, renderReportMarkdown, renderReportText } from './report';
import { contentRules, runRules, type ContentRule } from './rules/index';
import { runSmokeDays } from './smoke';

export const EXIT_OK = 0;
export const EXIT_INVALID = 1;
export const EXIT_USAGE = 2;

export const DEFAULT_SEED = 'validate';

/**
 * Rules `--skip-rule` refuses to skip. The real-name blocklist always runs, so no run can publish
 * content without that check.
 */
export const UNSKIPPABLE_RULES: readonly string[] = ['blocklist'];

/** Most days `--smoke-days` accepts. */
export const MAX_SMOKE_DAYS = 36500;

export const USAGE = `Usage: validate-world <packDir...> [options]

Checks a world's data packs and prints a distribution report. Relative paths are read from the
repository root. Dependency packs not passed in are looked up by pack ID under content/.

  packDir...            one or more pack folders (each holds a pack.json)
  --root <packId>       load from this pack (repeatable); default: the packs passed in
  --seed <s>            the seed IDs are minted from (default "${DEFAULT_SEED}")
  --report <file.md>    also write the report as markdown to this file
  --blocklist <file>    an extra real-name list, checked on top of ${COMMITTED_BLOCKLIST_PATH}
                        (repeatable; it never replaces the committed list)
  --strict              treat warnings as failures
  --skip-rule <id>      leave out one content rule (repeatable), for a world that is still
                        being built; the blocklist rule cannot be skipped
  --smoke-days <n>      advance the loaded world n days and fail on any step error
  -h, --help            show this help

Exit codes: 0 valid, 1 content errors (or warnings with --strict), 2 usage or I/O error.
`;

export interface CliIo {
  /** The repository root: relative paths, content/ and the committed blocklist are found here. */
  readonly repoRoot: string;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

interface CliOptions {
  readonly packDirs: readonly string[];
  readonly roots: readonly string[];
  readonly seed: string;
  readonly reportPath: string | null;
  readonly blocklists: readonly string[];
  readonly strict: boolean;
  readonly smokeDays: number | null;
  readonly skippedRules: readonly string[];
}

type ParseOutcome =
  | { readonly kind: 'options'; readonly options: CliOptions }
  | { readonly kind: 'help' }
  | { readonly kind: 'error'; readonly message: string };

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function parseCliArgs(argv: readonly string[]): ParseOutcome {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: {
        root: { type: 'string', multiple: true },
        seed: { type: 'string' },
        report: { type: 'string' },
        blocklist: { type: 'string', multiple: true },
        strict: { type: 'boolean', default: false },
        'smoke-days': { type: 'string' },
        'skip-rule': { type: 'string', multiple: true },
        help: { type: 'boolean', short: 'h', default: false },
      },
    });
  } catch (error: unknown) {
    return { kind: 'error', message: describeError(error) };
  }
  const { values, positionals } = parsed;
  if (values.help) {
    return { kind: 'help' };
  }
  if (positionals.length === 0) {
    return { kind: 'error', message: 'Give at least one pack folder' };
  }
  if (values.seed?.length === 0) {
    return { kind: 'error', message: '--seed must not be empty' };
  }
  let smokeDays: number | null = null;
  const smokeText = values['smoke-days'];
  if (smokeText !== undefined) {
    smokeDays = /^\d+$/.test(smokeText) ? Number(smokeText) : Number.NaN;
    if (!Number.isInteger(smokeDays) || smokeDays < 1 || smokeDays > MAX_SMOKE_DAYS) {
      return {
        kind: 'error',
        message: `--smoke-days must be a whole number from 1 to ${String(MAX_SMOKE_DAYS)}, not ${smokeText}`,
      };
    }
  }
  const skippedRules = values['skip-rule'] ?? [];
  const unskippable = skippedRules.find((ruleId) => UNSKIPPABLE_RULES.includes(ruleId));
  if (unskippable !== undefined) {
    return { kind: 'error', message: `--skip-rule cannot skip the ${unskippable} rule` };
  }
  return {
    kind: 'options',
    options: {
      packDirs: positionals,
      roots: values.root ?? [],
      seed: values.seed ?? DEFAULT_SEED,
      reportPath: values.report ?? null,
      blocklists: values.blocklist ?? [],
      strict: values.strict,
      smokeDays,
      skippedRules,
    },
  };
}

function printIssues(io: CliIo, issues: readonly ValidationIssue[]): void {
  for (const issue of [...issues].sort(compareValidationIssues)) {
    io.stdout(`${formatIssue(issue)}\n`);
  }
}

function summaryLine(issues: readonly ValidationIssue[], strict: boolean): string {
  const { errors, warnings } = countBySeverity(issues);
  const failed = errors > 0 || (strict && warnings > 0);
  return `${failed ? 'FAILED' : 'OK'}: ${String(errors)} error${errors === 1 ? '' : 's'}, ${String(warnings)} warning${warnings === 1 ? '' : 's'}${strict && warnings > 0 ? ' (--strict: warnings fail)' : ''}\n`;
}

function exitCodeFor(issues: readonly ValidationIssue[], strict: boolean): number {
  const { errors, warnings } = countBySeverity(issues);
  return errors > 0 || (strict && warnings > 0) ? EXIT_INVALID : EXIT_OK;
}

/**
 * The content rules minus the ones `--skip-rule` names, or an error message naming a rule ID that
 * does not exist (a typo must not silently skip nothing).
 */
function selectRules(
  rules: readonly ContentRule[],
  skippedRules: readonly string[],
): { readonly rules: readonly ContentRule[] } | { readonly error: string } {
  const known = new Set<string>(rules.map((rule) => rule.id));
  const unknown = skippedRules.find((ruleId) => !known.has(ruleId));
  if (unknown !== undefined) {
    return {
      error: `--skip-rule names an unknown rule: ${unknown} (rules: ${[...known].sort().join(', ')})`,
    };
  }
  const skipped = new Set(skippedRules);
  return { rules: rules.filter((rule) => !skipped.has(rule.id)) };
}

/** Resolves and merges the packs again to hand the rules the merged records the loader used. */
function mergedContentOf(
  rawPacks: readonly RawPack[],
  roots: readonly string[],
): MergedContent | null {
  const resolved = packs.resolvePacks(rawPacks, roots);
  if (!resolved.ok) {
    return null;
  }
  const merged = packs.mergeRecords(resolved.value);
  return merged.ok ? merged.value : null;
}

/** Runs the command and returns its exit code. Never calls `process.exit`. */
export async function runValidateWorld(argv: readonly string[], io: CliIo): Promise<number> {
  const parsed = parseCliArgs(argv);
  if (parsed.kind === 'help') {
    io.stdout(USAGE);
    return EXIT_OK;
  }
  if (parsed.kind === 'error') {
    io.stderr(`${parsed.message}\n\n${USAGE}`);
    return EXIT_USAGE;
  }
  const { options } = parsed;
  const fromRoot = (path: string): string => resolve(io.repoRoot, path);
  const shown = (path: string): string => displayPath(io.repoRoot, path);

  // The blocklist comes first: without it the run must not report success.
  let blocklist;
  try {
    const committedPath = join(io.repoRoot, COMMITTED_BLOCKLIST_PATH);
    blocklist = await loadBlocklist(
      { path: committedPath, displayPath: COMMITTED_BLOCKLIST_PATH },
      options.blocklists.map((path) => ({
        path: fromRoot(path),
        displayPath: shown(fromRoot(path)),
      })),
    );
  } catch (error: unknown) {
    if (error instanceof BlocklistError) {
      io.stderr(`${error.message}\n`);
      return EXIT_USAGE;
    }
    throw error;
  }

  const selected = selectRules(contentRules({ blocklist }), options.skippedRules);
  if ('error' in selected) {
    io.stderr(`${selected.error}\n\n${USAGE}`);
    return EXIT_USAGE;
  }

  let read;
  try {
    read = await readPacks(options.packDirs.map(fromRoot), {
      contentRoot: join(io.repoRoot, 'content'),
      displayRoot: io.repoRoot,
    });
  } catch (error: unknown) {
    if (error instanceof PackDirectoryError) {
      io.stderr(`${error.message}\n`);
      return EXIT_USAGE;
    }
    throw error;
  }
  if (read.issues.some((issue) => issue.severity === 'error')) {
    printIssues(io, read.issues);
    io.stdout(summaryLine(read.issues, options.strict));
    return EXIT_INVALID;
  }

  const roots = options.roots.length > 0 ? options.roots : read.requestedIds;
  const loaded = loadWorldFromPacks(read.packs, roots, { seed: options.seed });
  if (!loaded.ok) {
    const issues = [...read.issues, ...loaded.issues];
    printIssues(io, issues);
    io.stdout(summaryLine(issues, options.strict));
    return EXIT_INVALID;
  }
  const content = mergedContentOf(read.packs, roots);
  if (content === null) {
    // loadWorldFromPacks succeeded on the same input, so this cannot happen.
    throw new Error('The packs loaded but could not be merged a second time');
  }

  const world: LoadedWorld['world'] = loaded.value.world;
  const issues: ValidationIssue[] = [
    ...read.issues,
    ...loaded.issues,
    ...runRules(selected.rules, world, content),
  ];

  const report = buildReport(world, content);
  io.stdout(renderReportText(report));
  if (options.reportPath !== null) {
    const reportFile = fromRoot(options.reportPath);
    try {
      await mkdir(dirname(reportFile), { recursive: true });
      await writeFile(reportFile, renderReportMarkdown(report), 'utf8');
    } catch (error: unknown) {
      io.stderr(`Cannot write the report to ${shown(reportFile)}: ${describeError(error)}\n`);
      return EXIT_USAGE;
    }
    io.stdout(`\nReport written to ${shown(reportFile)}\n`);
  }

  let smokeFailed = false;
  if (options.smokeDays !== null) {
    const outcome = await runSmokeDays(loaded.value, options.smokeDays);
    if (outcome.status === 'passed') {
      io.stdout(
        `\nSmoke run: ${String(outcome.daysAdvanced)} days advanced with no step errors.\n`,
      );
    } else {
      smokeFailed = true;
      io.stdout(
        `\nSmoke run failed after ${String(outcome.daysAdvanced)} days:\n${outcome.failures.map((failure) => `  ${failure}\n`).join('')}`,
      );
    }
  }

  io.stdout('\n');
  if (options.skippedRules.length > 0) {
    io.stdout(`Skipped rules: ${[...options.skippedRules].sort().join(', ')}\n`);
  }
  printIssues(io, issues);
  io.stdout(summaryLine(issues, options.strict));
  return smokeFailed ? EXIT_INVALID : exitCodeFor(issues, options.strict);
}
