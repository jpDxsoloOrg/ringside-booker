/**
 * The finish catalog (MTCH2): how a match ends, as structured data. The schema and the category and
 * outcome-kind lists live with the other runtime catalogs in `model/catalogs.ts`; they are
 * re-exported here so the match system has one place for finishes.
 *
 * `checkFinishCatalog` is the sanity check validate:world runs on the catalogs a pack set builds
 * (its `segment-keys` rule) and a unit test runs on the shipped data:
 *
 * - every entry parses with `FinishEntrySchema` and sits under its own key, and no two entries share
 *   a key;
 * - every `methods[].methodKey` names a method, and every `matchTypes` key names a match type;
 * - every match type allows at least one `win` finish with `autoWeight > 0`, so an automatic
 *   finish always exists (side count taken as the type's minimum);
 * - a `win` finish that lets a title change hands lists at least one method that can move a title.
 *
 * Nothing throws; each problem is one issue. Design: docs/design/match-finishes.md.
 */

import {
  FinishEntrySchema,
  type Catalogs,
  type FinishEntry as FinishEntryDef,
  type MatchTypeDef,
} from '../../../model/catalogs';
import type { DeepReadonly } from '../../../model/world';

type FinishEntry = DeepReadonly<FinishEntryDef>;

export {
  FINISH_CATEGORIES,
  FINISH_OUTCOME_KINDS,
  FinishEntrySchema,
  type FinishCategory,
  type FinishEntry,
  type FinishOutcomeKind,
} from '../../../model/catalogs';

/** One problem with a finish catalog. */
export interface FinishCatalogIssue {
  /** Stable code, one of {@link FINISH_CATALOG_ISSUE_CODES}. */
  readonly code: string;
  /** The finish (or, for `noAutoFinish`, the match type) the issue is about. */
  readonly key: string;
  /** The field inside the entry, such as `methods[1].methodKey`, when there is one. */
  readonly path?: string;
  readonly message: string;
}

/** Issue codes `checkFinishCatalog` reports. */
export const FINISH_CATALOG_ISSUE_CODES = {
  invalid: 'finishes.invalid',
  keyMismatch: 'finishes.keyMismatch',
  duplicateKey: 'finishes.duplicateKey',
  unknownMethod: 'finishes.unknownMethod',
  unknownMatchType: 'finishes.unknownMatchType',
  noAutoFinish: 'finishes.noAutoFinish',
  noTitleMethod: 'finishes.noTitleMethod',
} as const;

const CODES = FINISH_CATALOG_ISSUE_CODES;

function compareText(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

function formatPath(path: readonly PropertyKey[]): string {
  return path
    .map((step, index) =>
      typeof step === 'number' ? `[${String(step)}]` : `${index === 0 ? '' : '.'}${String(step)}`,
    )
    .join('');
}

/** True when the finish's `matchTypes` rule admits the match type. */
export function finishAdmitsMatchType(finish: FinishEntry, matchTypeKey: string): boolean {
  const { only, except } = finish.matchTypes;
  if (only !== undefined) {
    return only.some((key) => key === matchTypeKey);
  }
  if (except !== undefined) {
    return !except.some((key) => key === matchTypeKey);
  }
  return true;
}

function checkEntry(
  recordKey: string,
  entry: FinishEntry,
  catalogs: DeepReadonly<Catalogs>,
  issues: FinishCatalogIssue[],
): void {
  const parsed = FinishEntrySchema.safeParse(entry);
  if (!parsed.success) {
    for (const zodIssue of parsed.error.issues) {
      const path = formatPath(zodIssue.path);
      issues.push({
        code: CODES.invalid,
        key: recordKey,
        ...(path === '' ? {} : { path }),
        message: `finish ${recordKey}: ${path === '' ? '' : `${path} `}${zodIssue.message}`,
      });
    }
  }
  if (entry.key !== recordKey) {
    issues.push({
      code: CODES.keyMismatch,
      key: recordKey,
      path: 'key',
      message: `finish ${recordKey}: is stored under ${recordKey} but its key is ${entry.key}`,
    });
  }
  const methods = catalogs.methods ?? {};
  entry.methods.forEach((method, index) => {
    if (!Object.hasOwn(methods, method.methodKey)) {
      issues.push({
        code: CODES.unknownMethod,
        key: recordKey,
        path: `methods[${String(index)}].methodKey`,
        message: `finish ${recordKey}: method ${method.methodKey} is not in the method catalog`,
      });
    }
  });
  const matchTypes = catalogs.matchTypes ?? {};
  for (const field of ['only', 'except'] as const) {
    (entry.matchTypes[field] ?? []).forEach((matchTypeKey, index) => {
      if (!Object.hasOwn(matchTypes, matchTypeKey)) {
        issues.push({
          code: CODES.unknownMatchType,
          key: recordKey,
          path: `matchTypes.${field}[${String(index)}]`,
          message: `finish ${recordKey}: match type ${matchTypeKey} is not in the match type catalog`,
        });
      }
    });
  }
  if (entry.outcomeKind === 'win' && entry.allowsTitleChange) {
    const movesTitles = entry.methods.some(
      (method) =>
        Object.hasOwn(methods, method.methodKey) && methods[method.methodKey]?.changesTitles,
    );
    if (!movesTitles) {
      issues.push({
        code: CODES.noTitleMethod,
        key: recordKey,
        path: 'allowsTitleChange',
        message: `finish ${recordKey}: lets a title change hands but none of its methods can move a title`,
      });
    }
  }
}

function hasAutoWinFinish(
  matchType: DeepReadonly<MatchTypeDef>,
  finishes: readonly FinishEntry[],
): boolean {
  return finishes.some(
    (finish) =>
      finish.outcomeKind === 'win' &&
      finish.autoWeight > 0 &&
      finishAdmitsMatchType(finish, matchType.key) &&
      (!finish.requiresTwoSides || matchType.sides.min <= 2),
  );
}

/**
 * Every problem with the world's finish catalog, finishes in key order, then the match types with
 * no automatic win finish in key order. Empty when the catalogs hold no finishes.
 */
export function checkFinishCatalog(catalogs: DeepReadonly<Catalogs>): FinishCatalogIssue[] {
  const { finishes } = catalogs;
  if (finishes === undefined) {
    return [];
  }
  const issues: FinishCatalogIssue[] = [];
  const stored = Object.entries(finishes).sort(([left], [right]) => compareText(left, right));
  const seen = new Map<string, string>();
  for (const [recordKey, entry] of stored) {
    checkEntry(recordKey, entry, catalogs, issues);
    const first = seen.get(entry.key);
    if (first !== undefined) {
      issues.push({
        code: CODES.duplicateKey,
        key: recordKey,
        path: 'key',
        message: `finish ${recordKey}: key ${entry.key} is also used by the entry under ${first}`,
      });
    } else {
      seen.set(entry.key, recordKey);
    }
  }
  const entries = Object.values(finishes);
  const matchTypes = Object.values(catalogs.matchTypes ?? {}).sort((left, right) =>
    compareText(left.key, right.key),
  );
  for (const matchType of matchTypes) {
    if (!hasAutoWinFinish(matchType, entries)) {
      issues.push({
        code: CODES.noAutoFinish,
        key: matchType.key,
        message: `match type ${matchType.key} allows no win finish with an autoWeight above 0, so no finish can be picked automatically`,
      });
    }
  }
  return issues;
}
