/**
 * Problems found while loading data packs.
 *
 * The loader never throws for bad content. Every problem it finds becomes a `PackIssue` naming the
 * pack, the file, the record kind, the record key and the field path, so the pack checker (WLD-03)
 * and the new-game screen (WLD-10) can point at the exact field. Exceptions are kept for
 * programming errors (a caller passing an invalid option, a broken invariant inside the loader).
 *
 * Format doc: docs/design/data-packs.md, "Loading".
 */

import type { RecordKind } from './keys';

/** How serious an issue is. Any `error` stops the load; warnings come back with the world. */
export type PackIssueSeverity = 'error' | 'warning';

/**
 * Every issue code the loader reports. The "Loading" section of the format doc has a table of
 * them with what each one means.
 */
export const PACK_ISSUE_CODES = [
  /** A manifest does not match the manifest schema. */
  'manifest',
  /** Two packs passed in share an ID. */
  'duplicate-pack',
  /** A root or a `dependsOn` entry names a pack that was not passed in. */
  'missing-dependency',
  /** A dependency was found but its version is outside the range asked for. */
  'version-mismatch',
  /** Packs depend on each other in a loop. */
  'dependency-cycle',
  /** The manifest lists a file for a kind, but no data for that kind was passed in. */
  'missing-file',
  /** Data was passed in for a kind the manifest does not list. */
  'unlisted-file',
  /** A record (or a merged record) does not match its kind's schema. */
  'schema',
  /** A key is added twice: in one file, or by two packs without an override marker. */
  'duplicate-key',
  /** A `base` pack uses `$override` or `$remove`. */
  'override-not-allowed',
  /** `$override` or `$remove` names a key that none of the pack's dependencies defines. */
  'override-target-missing',
  /** A reference names a key that no loaded record of the target kind has. */
  'unknown-reference',
  /** A reference names a key that exists, but only as a record of another kind. */
  'wrong-kind-reference',
  /** A region lists a neighbour that does not list it back. The loader adds the missing side. */
  'one-sided-neighbour',
  /** An angle template uses a beat its angle type does not allow (MTCH5). */
  'beat-not-allowed',
  /** No start date was given and no loaded world pack sets one. */
  'missing-start-date',
  /** A loaded record does not make a valid entity, or the finished world fails `checkWorld`. */
  'entity-schema',
  /** An angle template happens somewhere its angle type or one of its beats does not allow (MTCH5-08). */
  'setting-not-allowed',
] as const;

export type PackIssueCode = (typeof PACK_ISSUE_CODES)[number];

export interface PackIssue {
  readonly severity: PackIssueSeverity;
  readonly code: PackIssueCode;
  /** The pack the problem is in. For a merged record, the last pack that wrote it. */
  readonly packId: string;
  /** The file inside the pack, as its manifest lists it, when the problem is in a record file. */
  readonly file?: string;
  readonly kind?: RecordKind;
  readonly recordKey?: string;
  /**
   * Where the problem is. For a record: `[kind, recordKey, ...field path]`, such as
   * `['employment', 'emp-x', 'personKey']`. For a manifest: the path inside `pack.json`.
   */
  readonly path: readonly (string | number)[];
  readonly message: string;
}

/**
 * The outcome of a loading step. On success, `issues` holds only warnings; on failure, at least
 * one error and any warnings found on the way.
 */
export type Result<T, Issues extends readonly PackIssue[] = readonly PackIssue[]> =
  | { readonly ok: true; readonly value: T; readonly issues: Issues }
  | { readonly ok: false; readonly issues: Issues };

export function isError(issue: PackIssue): boolean {
  return issue.severity === 'error';
}

/** True when any of the issues is an error. */
export function hasErrors(issues: readonly PackIssue[]): boolean {
  return issues.some(isError);
}

/** Shorthand for an error-level issue. */
export function packError(issue: Omit<PackIssue, 'severity'>): PackIssue {
  return { severity: 'error', ...issue };
}

/** Shorthand for a warning-level issue. */
export function packWarning(issue: Omit<PackIssue, 'severity'>): PackIssue {
  return { severity: 'warning', ...issue };
}

/**
 * One line per issue, such as
 * `error unknown-reference mini-world/employments.json employment.emp-x.personKey: ...`.
 */
export function formatPackIssue(issue: PackIssue): string {
  const location = issue.file === undefined ? issue.packId : `${issue.packId}/${issue.file}`;
  const path = issue.path.length === 0 ? '' : ` ${issue.path.map(String).join('.')}`;
  return `${issue.severity} ${issue.code} ${location}${path}: ${issue.message}`;
}

/** Orders issues by pack, kind, key, path and code, so a report reads the same on every run. */
export function compareIssues(left: PackIssue, right: PackIssue): number {
  const leftKey = [left.packId, left.kind ?? '', left.recordKey ?? '', left.path.join('\u0000')];
  const rightKey = [
    right.packId,
    right.kind ?? '',
    right.recordKey ?? '',
    right.path.join('\u0000'),
  ];
  for (let index = 0; index < leftKey.length; index += 1) {
    const leftPart = leftKey[index] ?? '';
    const rightPart = rightKey[index] ?? '';
    if (leftPart !== rightPart) {
      return leftPart < rightPart ? -1 : 1;
    }
  }
  if (left.code !== right.code) {
    return left.code < right.code ? -1 : 1;
  }
  return 0;
}
