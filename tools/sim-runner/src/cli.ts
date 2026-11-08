/**
 * Entry point of the headless runner: `npm run sim -- --days <n> [options]` from the repository
 * root. See `args.ts` for the options.
 *
 * Exit codes: 0 success, 1 a determinism mismatch (or a step failure under `--strict`), 2 bad
 * arguments or a world that cannot be read, 3 stopped by a gate.
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SystemBundle } from '@ringside/engine';
import { parseRunnerArgs, USAGE, type ArgumentError, type RunnerOptions } from './args';
import { loadStartState, runSimulation, type CompletedRun } from './run';
import {
  compareRuns,
  formatDeterminismText,
  formatJsonReport,
  formatSummaryText,
  type DeterminismCheck,
  type JsonReport,
  type TextStyle,
} from './summary';
import { formatTraceEntry } from './traceText';

export const EXIT_OK = 0;
export const EXIT_FAILED = 1;
export const EXIT_USAGE = 2;
export const EXIT_GATE = 3;

/** What tests can swap out: the system bundles the runs use (default `defaultSystems`). */
export interface CliDependencies {
  readonly systems?: readonly SystemBundle[];
}

/** Where the runner writes, so tests can capture it. */
export interface CliIo {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  /** True when stdout is a terminal: only then does the text report use colours. */
  readonly color: boolean;
}

function argumentErrorText(errors: readonly ArgumentError[]): string {
  return `${errors.map((error) => `Error: ${error.message}`).join('\n')}\n\n${USAGE}`;
}

/** Prints the run (and the determinism check) in the chosen format. */
function printReport(
  options: RunnerOptions,
  run: CompletedRun,
  determinism: DeterminismCheck | null,
  io: CliIo,
): void {
  if (options.json) {
    const report: JsonReport = {
      ...run.summary,
      ...(determinism === null ? {} : { determinism }),
      ...(run.trace === undefined ? {} : { trace: run.trace }),
    };
    io.stdout(formatJsonReport(report));
    return;
  }
  const style: TextStyle = { color: io.color };
  io.stdout(formatSummaryText(run.summary, style));
  if (determinism !== null) {
    io.stdout(`\n${formatDeterminismText(determinism, style)}`);
  }
  if (options.trace !== null && run.trace !== undefined) {
    io.stdout(`\n${formatTraceEntry(options.trace, run.trace)}`);
  }
}

/** Runs the runner with `argv` (without the `node script` prefix) and returns the exit code. */
export async function runCli(
  argv: readonly string[],
  io: CliIo,
  dependencies: CliDependencies = {},
): Promise<number> {
  const parsed = parseRunnerArgs(argv);
  if (parsed.kind === 'help') {
    io.stdout(USAGE);
    return EXIT_OK;
  }
  if (parsed.kind === 'errors') {
    io.stderr(argumentErrorText(parsed.errors));
    return EXIT_USAGE;
  }
  const { options } = parsed;

  const start = await loadStartState(options);
  if (!start.ok) {
    io.stderr(`${start.errors.map((error) => `Error: ${error}`).join('\n')}\n`);
    return EXIT_USAGE;
  }

  const runs: CompletedRun[] = [];
  const runCount = options.checkDeterminism ? 2 : 1;
  for (let runIndex = 0; runIndex < runCount; runIndex++) {
    const outcome = await runSimulation(start.state, {
      days: options.days,
      tunables: options.tunables,
      trace: options.trace,
      ...(dependencies.systems === undefined ? {} : { systems: dependencies.systems }),
    });
    if (outcome.kind === 'argumentErrors') {
      io.stderr(argumentErrorText(outcome.errors));
      return EXIT_USAGE;
    }
    if (outcome.kind === 'loadError') {
      io.stderr(`${outcome.errors.map((error) => `Error: ${error}`).join('\n')}\n`);
      return EXIT_USAGE;
    }
    runs.push(outcome);
  }
  const [firstRun, secondRun] = runs;
  if (firstRun === undefined) {
    return EXIT_FAILED;
  }
  const determinism = secondRun === undefined ? null : compareRuns(firstRun, secondRun);
  printReport(options, firstRun, determinism, io);

  if (determinism !== null && !determinism.match) {
    io.stderr('Determinism check failed: two runs from the same start differ.\n');
    return EXIT_FAILED;
  }
  if (firstRun.summary.stoppedBy.kind === 'gate') {
    const reasons = firstRun.summary.stoppedBy.hits.map((hit) => `  ${hit.gateId}: ${hit.reason}`);
    io.stderr(
      `Stopped by a gate after ${String(firstRun.summary.daysAdvanced)} days:\n${reasons.join('\n')}\n`,
    );
    return EXIT_GATE;
  }
  if (options.strict && firstRun.failures.length > 0) {
    io.stderr(`--strict: ${String(firstRun.failures.length)} steps failed.\n`);
    return EXIT_FAILED;
  }
  return EXIT_OK;
}

/** True when this file is the script Node was started with, not a module a test imported. */
function isEntryPoint(): boolean {
  const scriptPath = process.argv[1];
  return scriptPath !== undefined && resolve(scriptPath) === fileURLToPath(import.meta.url);
}

if (isEntryPoint()) {
  process.exitCode = await runCli(process.argv.slice(2), {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    color: process.stdout.isTTY && process.env['NO_COLOR'] === undefined,
  });
}
