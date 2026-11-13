/**
 * Shared zod building blocks for entity, save and data-pack schemas.
 *
 * Every schema builds its fields from these helpers so the same value is validated the same way
 * everywhere. Number helpers never accept NaN or Infinity: zod 4 number schemas reject non-finite
 * values on their own, and the tests pin that behaviour so a bad number can never reach a save.
 */

import { z } from 'zod';
import { isContentKey, type ContentKey } from '../core/content-key';
import { isGameDate, isYearMonth, type GameDate, type YearMonth } from '../core/date';
import { ENTITY_KINDS, isId, type EntityKind, type IdOf } from '../core/ids';
import { isCents, type Cents } from '../core/money';

export { zWeekday } from '../core/date';

/**
 * An ID of one entity kind, for example `zId('person')` accepts `per_0000000001` only. The schema's
 * input type is the ID type too, so it can also key a record (`z.record(zId('region'), zStat)`).
 */
export function zId<K extends EntityKind>(kind: K): z.ZodCustom<IdOf<K>, IdOf<K>> {
  return z.custom<IdOf<K>>((value) => isId(kind, value), {
    message: `Expected a ${kind} ID (${ENTITY_KINDS[kind]}_ followed by 10 base32 characters)`,
  });
}

/** A calendar month in `YYYY-MM` form (`yearMonthOf(date)`). */
export const zYearMonth = z.custom<YearMonth>(isYearMonth, {
  message: 'Expected a month in the form YYYY-MM',
});

/** A game date in `YYYY-MM-DD` form, years 1900-2999. */
export const zGameDate = z.custom<GameDate>(isGameDate, {
  message: 'Expected a game date in the form YYYY-MM-DD (years 1900-2999)',
});

/** An amount of money in integer cents; may be negative. */
export const zCents = z.custom<Cents>(isCents, {
  message: 'Expected a whole number of cents',
});

/** An amount of money in integer cents that is zero or more. */
export const zNonNegativeCents = z.custom<Cents>((value) => isCents(value) && value >= 0, {
  message: 'Expected a whole number of cents, zero or more',
});

/** A 0-100 stat, such as a skill or popularity. Fractions are allowed. */
export const zStat = z.number().min(0).max(100);

/** A signed -100..100 value, such as a relationship or momentum. Fractions are allowed. */
export const zSigned100 = z.number().min(-100).max(100);

/** Basis points, a whole number in 0..10000 (10000 = 100%). */
export const zBasisPoints = z.number().int().min(0).max(10_000);

/** A whole number of 1 or more. */
export const zPositiveInt = z.number().int().min(1);

/** A whole number of 0 or more. */
export const zNonNegativeInt = z.number().int().min(0);

/** A key into a data-pack catalog, such as `finish.pinfall`. */
export const zContentKey = z.custom<ContentKey>(isContentKey, {
  message: 'Expected a content key such as "finish.pinfall"',
});

/**
 * A relative asset path (`people/per_0000000001.webp`) or a placeholder (`placeholder:person`).
 * Paths are slash-separated segments that cannot start with a dot, so `..`, absolute paths and
 * URLs with a scheme are all rejected.
 */
export const IMAGE_REF_PATTERN =
  /^(?:placeholder:[a-z][a-zA-Z0-9-]*|[A-Za-z0-9_-][A-Za-z0-9._-]*(?:\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*)$/;

/** An image reference, or null for "no image chosen". */
export const zImageRef = z
  .string()
  .regex(IMAGE_REF_PATTERN, 'Expected a relative asset path or "placeholder:<kind>"')
  .nullable();

export type ImageRef = z.infer<typeof zImageRef>;

/**
 * Text stored as a content key plus parameters, so mail and news can be localised later instead
 * of saving rendered English sentences.
 */
export const zTemplatedText = z.object({
  key: zContentKey,
  params: z.record(z.string(), z.union([z.string(), z.number()])),
});

export type TemplatedText = z.infer<typeof zTemplatedText>;
