/**
 * Tunable readers. A reader merges a definition set's defaults with a save's overrides and hands
 * out correctly typed values. Readers are immutable: changing an override produces a new reader, so
 * a step that is already running keeps the values it started with.
 */

import { isValueOfDefinition } from './define';
import type { TunableDefinitions, TunableRawValue, TunableValue } from './define';
import { sortOverrides, type TunableOverrides } from './overrides';
import { validateOverride, validateOverrides, type TunableIssue } from './validate';

/** Typed, read-only access to a set of tunables. */
export interface TunableReader<Defs extends TunableDefinitions> {
  /** The definitions this reader resolves. */
  readonly definitions: Defs;
  /** The accepted overrides, sorted by key. This is what a save stores. */
  readonly overrides: TunableOverrides;
  /** The current value: the override when one is set (including 0, false and ''), otherwise the default. */
  get<Key extends keyof Defs & string>(key: Key): TunableValue<Defs[Key]>;
  /** True only when the save sets this key, even if it sets it to the default value. */
  isOverridden(key: keyof Defs & string): boolean;
  /** The definition's default, ignoring any override. */
  defaultOf<Key extends keyof Defs & string>(key: Key): TunableValue<Defs[Key]>;
  /** The full definition of one tunable. */
  def<Key extends keyof Defs & string>(key: Key): Defs[Key];
}

/** The result of a live override change: a new reader, or the reason the value was refused. */
export type TunableChangeResult<Defs extends TunableDefinitions> =
  { ok: true; reader: TunableReader<Defs> } | { ok: false; issue: TunableIssue };

/** A reader together with every issue found while building it, for a save's load report. */
export interface LoadedTunables<Defs extends TunableDefinitions> {
  reader: TunableReader<Defs>;
  issues: TunableIssue[];
}

function requireDefinition<Defs extends TunableDefinitions, Key extends keyof Defs & string>(
  defs: Defs,
  key: Key,
): Defs[Key] {
  if (!Object.hasOwn(defs, key)) {
    throw new Error(`Unknown tunable "${key}".`);
  }
  return defs[key];
}

function buildReader<Defs extends TunableDefinitions>(
  defs: Defs,
  acceptedOverrides: TunableOverrides,
): TunableReader<Defs> {
  const overrides = sortOverrides(acceptedOverrides);
  const resolved = new Map<string, TunableRawValue>();
  for (const [key, def] of Object.entries(defs)) {
    // Object.hasOwn, not a truthiness check: an override of 0, false or '' is a real value.
    const override = Object.hasOwn(overrides, key) ? overrides[key] : undefined;
    resolved.set(key, override ?? def.default);
  }

  const reader: TunableReader<Defs> = {
    definitions: defs,
    overrides,
    get<Key extends keyof Defs & string>(key: Key): TunableValue<Defs[Key]> {
      const def = requireDefinition(defs, key);
      // Every resolved value was checked against this key's definition when it was accepted, so
      // this guard only fails if that invariant is broken.
      const value = resolved.get(key);
      if (!isValueOfDefinition(def, value)) {
        throw new Error(`Tunable "${key}" holds a value that does not match its definition.`);
      }
      return value;
    },
    isOverridden(key: keyof Defs & string): boolean {
      return Object.hasOwn(overrides, key);
    },
    defaultOf<Key extends keyof Defs & string>(key: Key): TunableValue<Defs[Key]> {
      // A definition's default always has its own value type; defineTunables checks it.
      const def = requireDefinition(defs, key);
      const fallback: unknown = def.default;
      if (!isValueOfDefinition(def, fallback)) {
        throw new Error(`Tunable "${key}" has a default that does not match its definition.`);
      }
      return fallback;
    },
    def<Key extends keyof Defs & string>(key: Key): Defs[Key] {
      return requireDefinition(defs, key);
    },
  };
  return Object.freeze(reader);
}

/**
 * Builds a reader from a definition set and a save's overrides. Overrides that fail validation are
 * dropped so the default applies; use `loadTunables` when the issues are needed for a report.
 */
export function createTunables<const Defs extends TunableDefinitions>(
  defs: Defs,
  overrides: TunableOverrides,
): TunableReader<Defs> {
  return buildReader(defs, validateOverrides(defs, overrides).accepted);
}

/**
 * Load-time policy: builds a reader from raw override data (for example a save file) without ever
 * throwing. Unknown or invalid overrides are dropped and returned as issues for the load report.
 */
export function loadTunables<const Defs extends TunableDefinitions>(
  defs: Defs,
  rawOverrides: Readonly<Record<string, unknown>>,
): LoadedTunables<Defs> {
  const { accepted, issues } = validateOverrides(defs, rawOverrides);
  return { reader: buildReader(defs, accepted), issues };
}

/**
 * Live policy: returns a new reader with one override set, or the issue when the value is not
 * allowed. The original reader is unchanged.
 */
export function withOverride<Defs extends TunableDefinitions>(
  reader: TunableReader<Defs>,
  key: string,
  value: unknown,
): TunableChangeResult<Defs> {
  const found = validateOverride(reader.definitions, key, value);
  if (found !== null) {
    return { ok: false, issue: found };
  }
  if (typeof value !== 'number' && typeof value !== 'boolean' && typeof value !== 'string') {
    // validateOverride only accepts these three types; this narrows `value` for the compiler.
    return {
      ok: false,
      issue: {
        key,
        value,
        problem: 'wrongType',
        message: `Tunable "${key}" needs a number, true/false or text value.`,
      },
    };
  }
  return {
    ok: true,
    reader: buildReader(reader.definitions, { ...reader.overrides, [key]: value }),
  };
}

/**
 * Live policy: returns a new reader with one override removed, so the default applies again. Takes
 * any key, like {@link withOverride}, because both are called with keys that arrive at run time (a
 * command's arguments); removing a key that is not overridden returns an equal reader.
 */
export function withoutOverride<Defs extends TunableDefinitions>(
  reader: TunableReader<Defs>,
  key: string,
): TunableReader<Defs> {
  const remaining: Record<string, TunableRawValue> = {};
  for (const [overriddenKey, value] of Object.entries(reader.overrides)) {
    if (overriddenKey !== key) {
      remaining[overriddenKey] = value;
    }
  }
  return buildReader(reader.definitions, remaining);
}
