/**
 * Semantic versions and npm-style version ranges, just enough for pack dependencies.
 *
 * A pack's `version` is `MAJOR.MINOR.PATCH` with an optional pre-release (`1.2.0-beta.1`) and
 * build part. A `dependsOn` range is what `SEMVER_RANGE_PATTERN` in the manifest accepts:
 * comparators (`^1.2.0`, `~1.2`, `>=1.0.0`, `<2`, `=1.0.0`, `1.x`, `*`) separated by spaces within
 * a set, and sets joined by `||`. A version satisfies a range when it satisfies every comparator
 * of at least one set.
 *
 * The rules follow npm's: `^` allows changes that keep the left-most non-zero part, `~` allows
 * patch changes (minor changes when only the major is given), a partial version without an
 * operator is an x-range, and a pre-release version only matches a set that names a pre-release of
 * the same `MAJOR.MINOR.PATCH`.
 */

import { SEMVER_PATTERN } from './manifest';

export interface SemVer {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  /** Pre-release identifiers, such as `['beta', 1]`; empty for a release. */
  readonly prerelease: readonly (string | number)[];
}

type Operator = '<' | '<=' | '>' | '>=' | '=';

interface Comparator {
  readonly operator: Operator;
  readonly version: SemVer;
}

/** A comparator set; an empty set matches every release. Null means it matches nothing. */
type ComparatorSet = readonly Comparator[] | null;

const NUMERIC_IDENTIFIER = /^(?:0|[1-9]\d*)$/;

function parseIdentifiers(text: string | undefined): (string | number)[] {
  if (text === undefined || text === '') {
    return [];
  }
  return text
    .split('.')
    .map((identifier) => (NUMERIC_IDENTIFIER.test(identifier) ? Number(identifier) : identifier));
}

/** Parses `1.2.3`, `1.2.3-beta.1` or `1.2.3+build`. Returns null for anything else. */
export function parseSemVer(text: string): SemVer | null {
  if (!SEMVER_PATTERN.test(text)) {
    return null;
  }
  const [withoutBuild = ''] = text.split('+');
  const dashIndex = withoutBuild.indexOf('-');
  const core = dashIndex === -1 ? withoutBuild : withoutBuild.slice(0, dashIndex);
  const prerelease = dashIndex === -1 ? undefined : withoutBuild.slice(dashIndex + 1);
  const [major = 0, minor = 0, patch = 0] = core.split('.').map(Number);
  return { major, minor, patch, prerelease: parseIdentifiers(prerelease) };
}

function compareIdentifiers(left: string | number, right: string | number): number {
  if (typeof left === 'number' && typeof right === 'number') {
    return Math.sign(left - right);
  }
  // Numeric identifiers sort before alphanumeric ones.
  if (typeof left === 'number') {
    return -1;
  }
  if (typeof right === 'number') {
    return 1;
  }
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

/** Semver precedence: -1, 0 or 1. Build metadata is ignored. */
export function compareSemVer(left: SemVer, right: SemVer): number {
  const coreOrder =
    Math.sign(left.major - right.major) ||
    Math.sign(left.minor - right.minor) ||
    Math.sign(left.patch - right.patch);
  if (coreOrder !== 0) {
    return coreOrder;
  }
  // A release sorts after every pre-release of the same version.
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    return Math.sign(right.prerelease.length - left.prerelease.length);
  }
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftIdentifier = left.prerelease[index];
    const rightIdentifier = right.prerelease[index];
    if (leftIdentifier === undefined) {
      return -1;
    }
    if (rightIdentifier === undefined) {
      return 1;
    }
    const order = compareIdentifiers(leftIdentifier, rightIdentifier);
    if (order !== 0) {
      return order;
    }
  }
  return 0;
}

/** A version written in a range: missing or wildcard (`x`, `X`, `*`) parts are null. */
interface PartialVersion {
  readonly major: number | null;
  readonly minor: number | null;
  readonly patch: number | null;
  readonly prerelease: readonly (string | number)[];
}

const COMPARATOR_PATTERN = /^(\^|~|>=|<=|>|<|=)?(.*)$/;

function parsePart(text: string | undefined): number | null | undefined {
  if (text === undefined || text === 'x' || text === 'X' || text === '*') {
    return null;
  }
  return NUMERIC_IDENTIFIER.test(text) ? Number(text) : undefined;
}

function parsePartial(text: string): PartialVersion | null {
  const dashIndex = text.indexOf('-');
  const core = dashIndex === -1 ? text : text.slice(0, dashIndex);
  const prerelease = dashIndex === -1 ? undefined : text.slice(dashIndex + 1);
  const parts = core.split('.');
  if (parts.length > 3) {
    return null;
  }
  const [major, minor, patch] = [parsePart(parts[0]), parsePart(parts[1]), parsePart(parts[2])];
  if (major === undefined || minor === undefined || patch === undefined) {
    return null;
  }
  // Once a part is a wildcard, the parts after it are wildcards too (`1.x.3` means `1.x`).
  const minorPart = major === null ? null : minor;
  const patchPart = minorPart === null ? null : patch;
  return {
    major,
    minor: minorPart,
    patch: patchPart,
    prerelease: patchPart === null ? [] : parseIdentifiers(prerelease),
  };
}

function version(
  major: number,
  minor: number,
  patch: number,
  prerelease: readonly (string | number)[] = [],
): SemVer {
  return { major, minor, patch, prerelease };
}

/** The lowest version of the next release line, with `-0` so no pre-release of it slips in. */
function ceiling(major: number, minor: number, patch: number): SemVer {
  return version(major, minor, patch, [0]);
}

function expandCaret(partial: PartialVersion): ComparatorSet {
  const { major, minor, patch } = partial;
  if (major === null) {
    return [];
  }
  const lower = version(major, minor ?? 0, patch ?? 0, partial.prerelease);
  let upper: SemVer;
  if (major > 0 || minor === null) {
    upper = ceiling(major + 1, 0, 0);
  } else if (minor > 0 || patch === null) {
    upper = ceiling(0, minor + 1, 0);
  } else {
    upper = ceiling(0, 0, patch + 1);
  }
  return [
    { operator: '>=', version: lower },
    { operator: '<', version: upper },
  ];
}

function expandTilde(partial: PartialVersion): ComparatorSet {
  const { major, minor, patch } = partial;
  if (major === null) {
    return [];
  }
  const lower = version(major, minor ?? 0, patch ?? 0, partial.prerelease);
  const upper = minor === null ? ceiling(major + 1, 0, 0) : ceiling(major, minor + 1, 0);
  return [
    { operator: '>=', version: lower },
    { operator: '<', version: upper },
  ];
}

/** The range an x-range (`1`, `1.2`, `1.x`) covers, as a lower and an exclusive upper bound. */
function xRangeBounds(partial: PartialVersion): { lower: SemVer; upper: SemVer } | null {
  const { major, minor } = partial;
  if (major === null) {
    return null;
  }
  if (minor === null) {
    return { lower: version(major, 0, 0), upper: ceiling(major + 1, 0, 0) };
  }
  return { lower: version(major, minor, 0), upper: ceiling(major, minor + 1, 0) };
}

function expandOperator(operator: Operator, partial: PartialVersion): ComparatorSet {
  if (partial.patch !== null && partial.minor !== null && partial.major !== null) {
    const exact = version(partial.major, partial.minor, partial.patch, partial.prerelease);
    return [{ operator, version: exact }];
  }
  const bounds = xRangeBounds(partial);
  if (bounds === null) {
    // `*` with an operator: `>=*` and `<=*` match everything, `>*` and `<*` nothing.
    return operator === '>=' || operator === '<=' || operator === '=' ? [] : null;
  }
  switch (operator) {
    case '=':
      return [
        { operator: '>=', version: bounds.lower },
        { operator: '<', version: bounds.upper },
      ];
    case '>=':
      return [{ operator: '>=', version: bounds.lower }];
    case '>':
      // `>1.2` is `>=1.3.0`: the release itself, not its pre-releases.
      return [
        {
          operator: '>=',
          version: version(bounds.upper.major, bounds.upper.minor, bounds.upper.patch),
        },
      ];
    case '<':
      return [{ operator: '<', version: ceiling(bounds.lower.major, bounds.lower.minor, 0) }];
    case '<=':
      return [{ operator: '<', version: bounds.upper }];
  }
}

function parseComparator(text: string): ComparatorSet | undefined {
  const match = COMPARATOR_PATTERN.exec(text);
  const operator = match?.[1];
  const partial = parsePartial(match?.[2] ?? '');
  if (partial === null) {
    return undefined;
  }
  if (operator === '^') {
    return expandCaret(partial);
  }
  if (operator === '~') {
    return expandTilde(partial);
  }
  if (operator === undefined) {
    return expandOperator('=', partial);
  }
  if (
    operator === '<' ||
    operator === '<=' ||
    operator === '>' ||
    operator === '>=' ||
    operator === '='
  ) {
    return expandOperator(operator, partial);
  }
  return undefined;
}

function parseSet(text: string): ComparatorSet | undefined {
  const comparators: Comparator[] = [];
  for (const comparatorText of text.trim().split(/\s+/)) {
    if (comparatorText === '') {
      continue;
    }
    const expanded = parseComparator(comparatorText);
    if (expanded === undefined) {
      return undefined;
    }
    if (expanded === null) {
      return null;
    }
    comparators.push(...expanded);
  }
  return comparators;
}

function satisfiesComparator(candidate: SemVer, comparator: Comparator): boolean {
  const order = compareSemVer(candidate, comparator.version);
  switch (comparator.operator) {
    case '<':
      return order < 0;
    case '<=':
      return order <= 0;
    case '>':
      return order > 0;
    case '>=':
      return order >= 0;
    case '=':
      return order === 0;
  }
}

function sameCore(left: SemVer, right: SemVer): boolean {
  return left.major === right.major && left.minor === right.minor && left.patch === right.patch;
}

function satisfiesSet(candidate: SemVer, set: readonly Comparator[]): boolean {
  if (!set.every((comparator) => satisfiesComparator(candidate, comparator))) {
    return false;
  }
  if (candidate.prerelease.length === 0) {
    return true;
  }
  // A pre-release only matches a set that opts in to pre-releases of the same version. The `-0`
  // on an upper bound is not an opt-in.
  return set.some(
    (comparator) =>
      comparator.operator !== '<' &&
      comparator.version.prerelease.length > 0 &&
      sameCore(comparator.version, candidate),
  );
}

/**
 * True when `versionText` satisfies `rangeText`. Returns false for a version or range this module
 * cannot read; the manifest schema rejects those before the loader gets here.
 */
export function satisfiesRange(versionText: string, rangeText: string): boolean {
  const candidate = parseSemVer(versionText);
  if (candidate === null) {
    return false;
  }
  return rangeText.split('||').some((setText) => {
    const set = parseSet(setText);
    return set !== undefined && set !== null && satisfiesSet(candidate, set);
  });
}
