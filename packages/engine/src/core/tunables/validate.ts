/**
 * Override validation. The same checks run when a save loads (bad overrides are dropped and
 * reported) and when a player changes a tunable live (the change is refused with the issue).
 */

import type { TunableDef, TunableDefinitions, TunableRawValue } from './define';
import { sortOverrides, type TunableOverrides } from './overrides';

/** Why an override was refused. */
export type TunableProblem =
  'unknownKey' | 'wrongType' | 'belowMin' | 'aboveMax' | 'notInteger' | 'notFinite' | 'notAnOption';

/** One refused override, with enough detail for a load report or an editor error message. */
export interface TunableIssue {
  key: string;
  value: unknown;
  problem: TunableProblem;
  message: string;
}

/** The outcome of validating a whole set of overrides. */
export interface ValidatedOverrides {
  /** The overrides that passed, sorted by key. */
  accepted: TunableOverrides;
  /** One issue per refused override, in key order. */
  issues: TunableIssue[];
}

function describeValue(value: unknown): string {
  if (typeof value === 'string') {
    return `"${value}"`;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return String(value);
  }
  if (value === undefined) {
    return 'nothing';
  }
  return Array.isArray(value) ? 'a list' : `a value of type ${typeof value}`;
}

function issue(
  key: string,
  value: unknown,
  problem: TunableProblem,
  expectation: string,
): TunableIssue {
  return {
    key,
    value,
    problem,
    message: `Tunable "${key}" ${expectation}, got ${describeValue(value)}.`,
  };
}

function checkAgainstDefinition(key: string, def: TunableDef, value: unknown): TunableIssue | null {
  switch (def.kind) {
    case 'number':
    case 'integer': {
      const expectedKind = def.kind === 'integer' ? 'a whole number' : 'a number';
      if (typeof value !== 'number') {
        return issue(key, value, 'wrongType', `must be ${expectedKind}`);
      }
      if (!Number.isFinite(value)) {
        return issue(key, value, 'notFinite', 'must be a finite number');
      }
      if (def.kind === 'integer' && !Number.isInteger(value)) {
        return issue(key, value, 'notInteger', 'must be a whole number');
      }
      if (value < def.min) {
        return issue(key, value, 'belowMin', `must be at least ${String(def.min)}`);
      }
      if (value > def.max) {
        return issue(key, value, 'aboveMax', `must be at most ${String(def.max)}`);
      }
      return null;
    }
    case 'boolean':
      return typeof value === 'boolean'
        ? null
        : issue(key, value, 'wrongType', 'must be true or false');
    case 'enum': {
      const optionList = def.options.map((option) => `"${option}"`).join(', ');
      if (typeof value !== 'string') {
        return issue(key, value, 'wrongType', `must be one of ${optionList}`);
      }
      return def.options.includes(value)
        ? null
        : issue(key, value, 'notAnOption', `must be one of ${optionList}`);
    }
  }
}

/**
 * Checks one override against its definition. Returns `null` when the value is allowed, otherwise
 * the issue. The value is `unknown` because overrides arrive from save files and from the UI.
 */
export function validateOverride(
  defs: TunableDefinitions,
  key: string,
  value: unknown,
): TunableIssue | null {
  if (!Object.hasOwn(defs, key)) {
    return {
      key,
      value,
      problem: 'unknownKey',
      message: `There is no tunable called "${key}", so its override of ${describeValue(value)} was ignored.`,
    };
  }
  const def = defs[key];
  if (def === undefined) {
    return issue(key, value, 'unknownKey', 'has no definition');
  }
  return checkAgainstDefinition(key, def, value);
}

/**
 * Validates every override in a set. Nothing throws: valid overrides are returned in `accepted`
 * (sorted by key) and every refused one is reported in `issues`, so an old save that still carries
 * a removed or out-of-range tunable loads with the default in its place.
 */
export function validateOverrides(
  defs: TunableDefinitions,
  overrides: Readonly<Record<string, unknown>>,
): ValidatedOverrides {
  const accepted: Record<string, TunableRawValue> = {};
  const issues: TunableIssue[] = [];
  for (const key of Object.keys(overrides).sort()) {
    const value = overrides[key];
    const found = validateOverride(defs, key, value);
    if (found !== null) {
      issues.push(found);
    } else if (
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      typeof value === 'string'
    ) {
      accepted[key] = value;
    }
  }
  return { accepted: sortOverrides(accepted), issues };
}
