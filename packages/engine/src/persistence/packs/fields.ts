/**
 * Field schemas shared by every pack record kind, and the builder that turns a kind's fields into
 * the three shapes a record can take in a pack file.
 *
 * Numbers: zod 4 number schemas reject NaN and Infinity on their own (`.finite()` is a deprecated
 * no-op there), so every number field here is finite without saying so. The records test pins it.
 *
 * Format doc: docs/design/data-packs.md.
 */

import { z } from 'zod';
import { isGameDate, type GameDate } from '../../core/date';
import { CENTS_PER_UNIT } from '../../core/money';
import { keySchema, refSchema } from './keys';

/** An ISO `YYYY-MM-DD` date, years 1900-2999. Every date in every pack uses this schema. */
export const isoDateSchema = z.custom<GameDate>(isGameDate, {
  message: 'Expected an ISO date in the form YYYY-MM-DD (years 1900-2999)',
});

/** A 0-100 value such as interest, prestige or an attribute. Fractions are allowed. */
export const percentSchema = z.number().min(0).max(100);

/** A probability, 0-1. */
export const chanceSchema = z.number().min(0).max(1);

/**
 * The largest amount of money a pack may state, in whole currency units. The loader multiplies by
 * 100 to get cents, and the result must still be a safe integer.
 */
export const MAX_WHOLE_MONEY = Math.floor(Number.MAX_SAFE_INTEGER / CENTS_PER_UNIT);

/** Money in whole currency units; may be negative (a promotion in debt). */
export const wholeMoneySchema = z.number().int().min(-MAX_WHOLE_MONEY).max(MAX_WHOLE_MONEY);

/** Money in whole currency units, zero or more. */
export const nonNegativeWholeMoneySchema = z.number().int().min(0).max(MAX_WHOLE_MONEY);

/**
 * Popularity per region, sparse: a region left out reads as 0, and values run 1-100 so a pack never
 * spells out a zero.
 */
export const regionalPopSchema = z.record(refSchema, z.number().min(1).max(100));

/** `#rrggbb`. */
export const hexColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Expected a hex colour such as #1a2b3c');

// ---------------------------------------------------------------------------------------------
// Override markers

/**
 * How a record treats a record with the same key in a dependency pack: `replace` swaps it for this
 * one, `patch` shallow-merges the fields listed. Whether a pack may override at all is the loader's
 * check (only `addon` and `world` packs may), not the schema's.
 */
export const OVERRIDE_MODES = ['replace', 'patch'] as const;
export type OverrideMode = (typeof OVERRIDE_MODES)[number];

/** The fields every record kind declares: at least the record's `key`. */
type RecordShape = { key: typeof keySchema } & z.ZodRawShape;

/** Cross-field checks for a complete record. Not run on patches, whose fields are partial. */
export type RecordRefinement<Record> = (record: Record, context: z.RefinementCtx) => void;

function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function withoutField(
  value: Readonly<Record<string, unknown>>,
  field: string,
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([name]) => name !== field));
}

function isOverrideMode(value: unknown): value is OverrideMode {
  return OVERRIDE_MODES.some((mode) => mode === value);
}

/**
 * Builds the schemas for one record kind from its fields (a strict object holding `key` and every
 * other field, without cross-field checks):
 *
 * - `full`: a complete record. Runs `refine`. In a pack file it may also carry
 *   `"$override": "replace"`, which `entry` sets aside before the check and puts back after.
 * - `patch`: `"$override": "patch"` plus the key and any subset of the other fields (at least one).
 * - `remove`: `{ "key": ..., "$remove": true }` and nothing else.
 * - `entry`: what one element of a pack file may be. It picks the shape from the markers and reports
 *   only that shape's issues, so an error names the field that is wrong instead of a vague "no union
 *   member matched".
 */
export function defineRecordKind<Shape extends RecordShape>(
  fields: z.ZodObject<Shape, z.core.$strict>,
  refine?: RecordRefinement<z.output<z.ZodObject<Shape, z.core.$strict>>>,
) {
  const full = fields.superRefine((record, context) => {
    refine?.(record, context);
  });
  const patch = fields
    .partial()
    .extend({ key: keySchema, $override: z.literal('patch') })
    .superRefine((record, context) => {
      const patchedFields = Object.keys(record).filter(
        (field) => field !== 'key' && field !== '$override',
      );
      if (patchedFields.length === 0) {
        context.addIssue({
          code: 'custom',
          message: 'A patch must list at least one field to change',
        });
      }
    });
  const remove = z.strictObject({ key: keySchema, $remove: z.literal(true) });

  type FullRecord = z.output<typeof full> & { $override?: 'replace' };
  type PatchRecord = z.output<typeof patch>;
  type RemoveRecord = z.output<typeof remove>;

  const entry = z.unknown().transform((value, context): FullRecord | PatchRecord | RemoveRecord => {
    if (!isPlainObject(value)) {
      context.addIssue({ code: 'custom', message: 'Expected a record object' });
      return z.NEVER;
    }
    const override = value['$override'];
    if (override !== undefined && !isOverrideMode(override)) {
      context.addIssue({
        code: 'custom',
        message: 'Expected "$override" to be "replace" or "patch"',
        path: ['$override'],
      });
      return z.NEVER;
    }
    let result;
    if ('$remove' in value) {
      result = remove.safeParse(value);
    } else if (override === 'patch') {
      result = patch.safeParse(value);
    } else {
      // The replace marker is not one of the kind's fields, so it is set aside for the check.
      const parsed = full.safeParse(withoutField(value, '$override'));
      if (parsed.success) {
        return override === 'replace' ? { ...parsed.data, $override: override } : parsed.data;
      }
      result = parsed;
    }
    if (result.success) {
      return result.data;
    }
    for (const issue of result.error.issues) {
      context.addIssue({ code: 'custom', message: issue.message, path: issue.path });
    }
    return z.NEVER;
  });

  return { fields, full, patch, remove, entry } as const;
}
