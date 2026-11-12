/**
 * Issues the checker reports: the loader's own `PackIssue`s plus the problems only this tool finds
 * (unreadable JSON on disk and the content rules in `rules/`).
 *
 * The engine's `PackIssue` has a closed list of loader codes. Content rules are policy for shipped
 * content rather than loader behaviour, so their codes live here and a `ValidationIssue` is a
 * `PackIssue` whose code may also be one of them. Everything else (pack, file, kind, record key,
 * field path, message) has the same meaning as in the loader.
 */

import type { PackIssue, PackIssueCode, PackIssueSeverity, RecordKind } from '@ringside/engine';

/** Every content rule, by the ID it reports issues under. */
export const RULE_IDS = [
  'promotion-staffing',
  'champion-eligibility',
  'reign-chronology',
  'employment-dates',
  'unique-names',
  'geography',
  'free-agents',
  'age-sanity',
  'blocklist',
  'segment-keys',
  'segment-finishes',
] as const;

export type RuleId = (typeof RULE_IDS)[number];

/** Codes for problems found while reading packs from disk, before the loader sees them. */
export const READ_ISSUE_CODES = ['json-syntax', 'unreadable-file'] as const;

export type ReadIssueCode = (typeof READ_ISSUE_CODES)[number];

export type ValidationIssueCode = PackIssueCode | ReadIssueCode | RuleId;

export type ValidationIssue = Omit<PackIssue, 'code'> & { readonly code: ValidationIssueCode };

export interface IssueSpec {
  readonly code: ValidationIssueCode;
  readonly packId: string;
  readonly file?: string;
  readonly kind?: RecordKind;
  readonly recordKey?: string;
  readonly path: readonly (string | number)[];
  readonly message: string;
}

export function validationError(spec: IssueSpec): ValidationIssue {
  return { severity: 'error', ...spec };
}

export function validationWarning(spec: IssueSpec): ValidationIssue {
  return { severity: 'warning', ...spec };
}

export function issueWithSeverity(severity: PackIssueSeverity, spec: IssueSpec): ValidationIssue {
  return { severity, ...spec };
}

export function countBySeverity(issues: readonly ValidationIssue[]): {
  errors: number;
  warnings: number;
} {
  const errors = issues.filter((issue) => issue.severity === 'error').length;
  return { errors, warnings: issues.length - errors };
}

/**
 * One line per issue, in the loader's format:
 * `error champion-eligibility mini-world/title-reigns.json titleReign.reign-x.holderPersonKeys.0: ...`.
 */
export function formatIssue(issue: ValidationIssue): string {
  const location = issue.file === undefined ? issue.packId : `${issue.packId}/${issue.file}`;
  const path = issue.path.length === 0 ? '' : ` ${issue.path.map(String).join('.')}`;
  return `${issue.severity} ${issue.code} ${location}${path}: ${issue.message}`;
}

function compareText(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

/** Errors first, then by pack, kind, key, path, code and message, so every run prints the same. */
export function compareValidationIssues(left: ValidationIssue, right: ValidationIssue): number {
  if (left.severity !== right.severity) {
    return left.severity === 'error' ? -1 : 1;
  }
  const leftParts = [
    left.packId,
    left.kind ?? '',
    left.recordKey ?? '',
    left.path.map(String).join('\u0000'),
    left.code,
    left.message,
  ];
  const rightParts = [
    right.packId,
    right.kind ?? '',
    right.recordKey ?? '',
    right.path.map(String).join('\u0000'),
    right.code,
    right.message,
  ];
  for (let index = 0; index < leftParts.length; index += 1) {
    const order = compareText(leftParts[index] ?? '', rightParts[index] ?? '');
    if (order !== 0) {
      return order;
    }
  }
  return 0;
}
