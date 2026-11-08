/**
 * What loading a save reports. Every failure names the stage that stopped the load and lists the
 * problems with a path into the document and a message a player can act on.
 */

import { formatPath } from '../core/json';

/** The load stages, in the order they run. A load stops at the first stage that fails. */
export const LOAD_STAGES = [
  'decode',
  'parse',
  'format',
  'version',
  'migrate',
  'validate',
  'build',
  'integrity',
] as const;

export type LoadStage = (typeof LOAD_STAGES)[number];

/** One problem. `path` points into the document, for example `state.world.tables.people[12]`. */
export interface LoadIssue {
  /** Empty when the problem is with the whole file. */
  readonly path: string;
  readonly message: string;
}

/** The most issues a failure lists; `truncated` counts the rest. */
export const MAX_LOAD_ISSUES = 50;

export interface LoadFailure {
  readonly ok: false;
  readonly stage: LoadStage;
  /** At most `MAX_LOAD_ISSUES` issues. */
  readonly issues: readonly LoadIssue[];
  /** How many more issues were found beyond the cap. */
  readonly truncated: number;
}

/** The result of one load stage: its value, or the failure that stops the load. */
export type LoadResult<T> = { readonly ok: true; readonly value: T } | LoadFailure;

/**
 * A failure at `stage`, with the issue list capped at `MAX_LOAD_ISSUES`. `alreadyTruncated` adds
 * issues an earlier check found but did not list (`checkWorld` caps its own report).
 */
export function loadFailure(
  stage: LoadStage,
  issues: readonly LoadIssue[],
  alreadyTruncated = 0,
): LoadFailure {
  return {
    ok: false,
    stage,
    issues: issues.slice(0, MAX_LOAD_ISSUES),
    truncated: Math.max(0, issues.length - MAX_LOAD_ISSUES) + alreadyTruncated,
  };
}

/** A failure at `stage` with a single issue. */
export function singleIssueFailure(stage: LoadStage, path: string, message: string): LoadFailure {
  return loadFailure(stage, [{ path, message }]);
}

/** A zod issue path as a document path, such as `state.world.tables.people[12].attributes.mic`. */
export function documentPath(segments: readonly PropertyKey[]): string {
  const [first, ...rest] = segments;
  if (first === undefined) {
    return '';
  }
  return formatPath(typeof first === 'number' ? `[${String(first)}]` : String(first), rest);
}
