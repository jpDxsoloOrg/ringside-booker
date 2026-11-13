/**
 * The run summary: what one headless run did, as plain JSON, plus its text form.
 *
 * Everything except `wallMs` and `daysPerSecond` is deterministic: two runs from the same start
 * with the same arguments must give the same summary apart from those two fields.
 */

import type { AdvanceFailure, AdvanceStop, GameDate, StoredTraceEntry } from '@ringside/engine';

/** How many failures the summary lists in full. */
export const FIRST_FAILURES_LIMIT = 10;

/** What one run did. Plain JSON: `--json` prints it as it is. */
export interface RunSummary {
  /** The world date before the run. */
  startDate: GameDate;
  /** The world date after the run: the first day not simulated. */
  endDate: GameDate;
  daysAdvanced: number;
  /** `completed`, or the gate hits that stopped the run before the days ran out. */
  stoppedBy: AdvanceStop;
  /** Wall-clock time of the advance, in milliseconds. Not deterministic. */
  wallMs: number;
  /** Days simulated per wall-clock second. Not deterministic. */
  daysPerSecond: number;
  /** Failed steps counted by step id, keys sorted. */
  failuresByStep: Record<string, number>;
  /** The first {@link FIRST_FAILURES_LIMIT} failed steps, in the order they failed. */
  firstFailures: AdvanceFailure[];
  /** Committed events counted by type, keys sorted. */
  eventsByType: Record<string, number>;
  /** `worldHash` of the state at the end of the run. */
  worldHash: string;
  /** Tunable overrides in the starting state that were dropped because they no longer fit. */
  loadIssues: string[];
  /** The promotion history table at the end of the run (DAY2-01). */
  promotionHistory: PromotionHistorySummary;
}

/** How big the promotion history (`promotionSnapshots`) is at the end of a run. */
export interface PromotionHistorySummary {
  /** Promotions in the world, closed ones included. */
  promotions: number;
  /** History rows in the table. */
  rows: number;
  /** The most rows any one promotion has. */
  mostPerPromotion: number;
}

/** The outcome of `--check-determinism`. */
export interface DeterminismCheck {
  /** True when both runs ended with the same hash, event counts and failures. */
  match: boolean;
  /** The world hash of each run. */
  hashes: [string, string];
  /** What differed between the runs, in words. Empty when they match. */
  differences: string[];
}

/** What `--json` prints: the summary, plus the determinism check and the trace when asked for. */
export type JsonReport = RunSummary & {
  determinism?: DeterminismCheck;
  trace?: StoredTraceEntry | null;
};

/** A copy of `counts` with its keys in sorted order, so printed output is stable. */
export function sortedCounts(counts: ReadonlyMap<string, number>): Record<string, number> {
  const sortedKeys = [...counts.keys()].sort();
  return Object.fromEntries(sortedKeys.map((key) => [key, counts.get(key) ?? 0]));
}

/** Counts failures by step id. */
export function countFailuresByStep(failures: readonly AdvanceFailure[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const failure of failures) {
    counts.set(failure.stepId, (counts.get(failure.stepId) ?? 0) + 1);
  }
  return sortedCounts(counts);
}

/** Days per wall-clock second, to one decimal place. 0 when no time was measured. */
export function daysPerSecond(days: number, wallMs: number): number {
  if (wallMs <= 0) {
    return 0;
  }
  return Math.round((days / wallMs) * 10_000) / 10;
}

/** Describes every difference between two counts records. */
function countDifferences(
  what: string,
  first: Readonly<Record<string, number>>,
  second: Readonly<Record<string, number>>,
): string[] {
  const keys = [...new Set([...Object.keys(first), ...Object.keys(second)])].sort();
  const differences: string[] = [];
  for (const key of keys) {
    const firstCount = first[key] ?? 0;
    const secondCount = second[key] ?? 0;
    if (firstCount !== secondCount) {
      differences.push(
        `${what} ${key}: ${String(firstCount)} in run 1, ${String(secondCount)} in run 2`,
      );
    }
  }
  return differences;
}

/** One run's results that the determinism check compares. */
export interface ComparableRun {
  readonly summary: RunSummary;
  /** Every failed step of the run, in order. */
  readonly failures: readonly AdvanceFailure[];
}

/** Compares two runs from the same start: world hash, dates, event counts and failure lists. */
export function compareRuns(first: ComparableRun, second: ComparableRun): DeterminismCheck {
  const differences: string[] = [];
  const firstSummary = first.summary;
  const secondSummary = second.summary;
  if (firstSummary.worldHash !== secondSummary.worldHash) {
    differences.push(
      `world hash: ${firstSummary.worldHash} in run 1, ${secondSummary.worldHash} in run 2`,
    );
  }
  if (
    firstSummary.endDate !== secondSummary.endDate ||
    firstSummary.daysAdvanced !== secondSummary.daysAdvanced
  ) {
    differences.push(
      `days: run 1 advanced ${String(firstSummary.daysAdvanced)} to ${firstSummary.endDate}, run 2 advanced ${String(secondSummary.daysAdvanced)} to ${secondSummary.endDate}`,
    );
  }
  differences.push(
    ...countDifferences('events', firstSummary.eventsByType, secondSummary.eventsByType),
  );
  const firstFailures = JSON.stringify(first.failures);
  const secondFailures = JSON.stringify(second.failures);
  if (firstFailures !== secondFailures) {
    differences.push(
      `failures: ${String(first.failures.length)} in run 1, ${String(second.failures.length)} in run 2, or the same count in a different order or with different messages`,
    );
  }
  return {
    match: differences.length === 0,
    hashes: [firstSummary.worldHash, secondSummary.worldHash],
    differences,
  };
}

/** How the text formatter styles its output. */
export interface TextStyle {
  /** ANSI colours and bold headings. Only when stdout is a terminal. */
  readonly color: boolean;
}

const ANSI_RESET = '\u001b[0m';
const ANSI_BOLD = '\u001b[1m';
const ANSI_RED = '\u001b[31m';
const ANSI_GREEN = '\u001b[32m';
const ANSI_YELLOW = '\u001b[33m';

function paint(style: TextStyle, code: string, text: string): string {
  return style.color ? `${code}${text}${ANSI_RESET}` : text;
}

/** Rows of `label  value`, with every value starting in the same column. */
function alignedRows(rows: readonly (readonly [string, string])[], indent = '  '): string[] {
  const width = Math.max(0, ...rows.map(([label]) => label.length));
  return rows.map(([label, value]) => `${indent}${label.padEnd(width)}  ${value}`);
}

/** A counts table with the numbers right-aligned, or `(none)`. */
function countRows(counts: Readonly<Record<string, number>>): string[] {
  const entries = Object.entries(counts);
  if (entries.length === 0) {
    return ['  (none)'];
  }
  const numberWidth = Math.max(...entries.map(([, count]) => String(count).length));
  return alignedRows(entries.map(([key, count]) => [key, String(count).padStart(numberWidth)]));
}

function describeStop(stop: AdvanceStop): string {
  switch (stop.kind) {
    case 'completed':
      return 'completed';
    case 'cancelled':
      return 'cancelled';
    case 'gate':
      return `gate: ${stop.hits.map((hit) => `${hit.gateId} (${hit.reason})`).join('; ')}`;
  }
}

/** The summary as an aligned text report. */
export function formatSummaryText(summary: RunSummary, style: TextStyle): string {
  const heading = (text: string): string => paint(style, ANSI_BOLD, text);
  const stopText = describeStop(summary.stoppedBy);
  const failureCount = summary.firstFailures.length;
  const lines: string[] = [
    heading('Headless run'),
    ...alignedRows([
      ['Start date', summary.startDate],
      ['End date', summary.endDate],
      ['Days advanced', String(summary.daysAdvanced)],
      [
        'Stopped by',
        summary.stoppedBy.kind === 'completed'
          ? paint(style, ANSI_GREEN, stopText)
          : paint(style, ANSI_YELLOW, stopText),
      ],
      ['Wall time', `${summary.wallMs.toFixed(0)} ms`],
      ['Days per second', summary.daysPerSecond.toFixed(1)],
      ['World hash', summary.worldHash],
    ]),
    '',
    heading('Failures by step'),
    ...countRows(summary.failuresByStep),
  ];
  if (failureCount > 0) {
    lines.push('', heading(`First ${String(failureCount)} failures`));
    lines.push(
      ...summary.firstFailures.map((failure) =>
        paint(style, ANSI_RED, `  ${failure.date}  ${failure.stepId}: ${failure.message}`),
      ),
    );
  }
  lines.push('', heading('Events by type'), ...countRows(summary.eventsByType));
  const history = summary.promotionHistory;
  lines.push(
    '',
    heading('Promotion history'),
    ...alignedRows([
      ['Rows', `${String(history.rows)} for ${String(history.promotions)} promotion(s)`],
      ['Most for one promotion', String(history.mostPerPromotion)],
    ]),
  );
  if (summary.loadIssues.length > 0) {
    lines.push('', heading('Load issues'));
    lines.push(...summary.loadIssues.map((issue) => paint(style, ANSI_YELLOW, `  ${issue}`)));
  }
  return `${lines.join('\n')}\n`;
}

/** The determinism check as text. */
export function formatDeterminismText(check: DeterminismCheck, style: TextStyle): string {
  const result = check.match
    ? paint(style, ANSI_GREEN, 'OK: both runs match')
    : paint(style, ANSI_RED, 'MISMATCH: the two runs differ');
  const lines = [
    paint(style, ANSI_BOLD, 'Determinism check'),
    ...alignedRows([
      ['Run 1 hash', check.hashes[0]],
      ['Run 2 hash', check.hashes[1]],
      ['Result', result],
    ]),
    ...check.differences.map((difference) => `  - ${difference}`),
  ];
  return `${lines.join('\n')}\n`;
}

/** The JSON report, pretty-printed with a trailing newline. */
export function formatJsonReport(report: JsonReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
