/**
 * Shared machinery for the entity builders: the override type, the deep merge, the schema check
 * every built row goes through, and the fixed dates and placeholder names the defaults use.
 */

import { z } from 'zod';
import { addDays, parseGameDate, type GameDate } from '../../../src/core/date';
import type { WorldSettings } from '../../../src/model/world-meta';

type Primitive = string | number | boolean | bigint | symbol | null | undefined;

/**
 * Overrides for a builder: every field optional, and nested objects (`attributes`, `condition`,
 * `terms`, ...) optional all the way down. Arrays are replaced whole, never merged by index.
 * Branded strings such as IDs and dates stay branded.
 */
export type DeepPartial<T> = T extends Primitive
  ? T
  : T extends readonly unknown[]
    ? T
    : { [Key in keyof T]?: DeepPartial<T[Key]> };

/** The day every default date hangs off: a Monday. */
export const TEST_START_DATE: GameDate = parseGameDate('2026-01-05');

/** A long-ago date for things that have "always" existed: promotions, networks. */
export const TEST_FOUNDING_DATE: GameDate = parseGameDate('2000-01-03');

/** The human player every test world lists, and the one human controllers name. */
export const TEST_PLAYER_ID = 'player-1';

/** Default season length in days (13 weeks). */
export const TEST_SEASON_LENGTH_DAYS = 91;

/** The world settings every builder and test world uses unless a test overrides them. */
export const TEST_WORLD_SETTINGS: WorldSettings = {
  agingEnabled: true,
  sandbox: false,
  generationLevel: 'off',
  levelPlayingField: false,
  season: { lengthDays: TEST_SEASON_LENGTH_DAYS },
  extra: {},
};

/** The last day of a season that starts on `startDate` and runs `lengthDays` days. */
export function seasonEndDate(startDate: GameDate, lengthDays = TEST_SEASON_LENGTH_DAYS): GameDate {
  return addDays(startDate, lengthDays - 1);
}

/** `Test <label> 001`, `Test <label> 002`, ...: the fixed list placeholder names come from. */
export function placeholderName(label: string, number: number): string {
  return `Test ${label} ${String(number).padStart(3, '0')}`;
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** `A`, `B`, ... `Z`, `AA`, `AB`, ...: the label of the `number`th item, counted from 1. */
export function placeholderLetters(number: number): string {
  let remaining = number;
  let letters = '';
  while (remaining > 0) {
    const index = (remaining - 1) % LETTERS.length;
    letters = LETTERS.charAt(index) + letters;
    remaining = Math.floor((remaining - 1) / LETTERS.length);
  }
  return letters;
}

function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The schema inside any `.nullable()` and `.optional()` wrappers. */
function unwrapSchema(schema: z.core.$ZodType): z.core.$ZodType {
  if (schema instanceof z.ZodNullable || schema instanceof z.ZodOptional) {
    return unwrapSchema(schema.unwrap());
  }
  return schema;
}

/** The schema of `key` inside an object or record schema, when it can be found. */
function childSchema(
  schema: z.core.$ZodType | undefined,
  key: string,
): z.core.$ZodType | undefined {
  if (schema instanceof z.ZodObject) {
    const shape: Readonly<Record<string, unknown>> = schema.shape;
    const field = shape[key];
    return field instanceof z.ZodType ? field : undefined;
  }
  if (schema instanceof z.ZodRecord) {
    return schema.valueType;
  }
  return undefined;
}

/**
 * Merges `override` into `base`, guided by `schema` (the schema of the value being merged).
 *
 * Plain objects merge key by key, so `{ attributes: { mic: 90 } }` keeps the other attributes.
 * Anything else in `override` (arrays, primitives, null) replaces the base value. Where the schema
 * is a union (a recurrence, a controller, a match outcome) and the override names a different
 * `kind`, the override replaces the base whole, so switching a weekly recurrence to a monthly one
 * never leaves the weekly fields behind; such an override must then be complete.
 */
export function mergeDeep(
  schema: z.core.$ZodType | undefined,
  base: unknown,
  override: unknown,
): unknown {
  if (override === undefined) {
    return base;
  }
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return override;
  }
  const inner = schema === undefined ? undefined : unwrapSchema(schema);
  const switchesVariant =
    inner instanceof z.ZodUnion && 'kind' in override && override['kind'] !== base['kind'];
  if (switchesVariant) {
    return override;
  }
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    merged[key] = mergeDeep(childSchema(inner, key), base[key], value);
  }
  return merged;
}

/**
 * Merges `overrides` into `defaults` and parses the result with `schema`, so a builder only ever
 * returns a row that passes its schema. Throws with every issue listed when the overrides make
 * the row invalid.
 */
export function buildRow<Row>(
  schema: z.ZodType<Row>,
  label: string,
  defaults: Row,
  overrides: unknown,
): Row {
  const result = schema.safeParse(mergeDeep(schema, defaults, overrides));
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  ${issue.path.map(String).join('.') || '(row)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`${label}: the overrides make an invalid row\n${issues}`);
  }
  return result.data;
}
