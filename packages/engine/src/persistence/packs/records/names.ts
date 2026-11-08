/**
 * Name records: the word lists the people generator (WLD-05) draws real names and ring names from.
 *
 * - A **name culture** is a pool of given names and surnames with weights.
 * - A **country name mix** says which cultures a country's people are named from, and how often.
 * - **Ring name words** feed the ring name patterns, such as `{adjective} {noun}`.
 */

import { z } from 'zod';
import { hasDuplicates } from '../../../model/entities/unique';
import { chanceSchema, defineRecordKind } from '../fields';
import { keySchema, parseRef, refSchema, type RecordReference } from '../keys';

/** A name and how often it is picked relative to the others in its list (a whole number ≥ 1). */
export const weightedNameSchema = z.tuple([
  z.string().min(1).max(40),
  z.number().int().min(1).max(1_000_000),
]);

export type WeightedName = z.output<typeof weightedNameSchema>;

/** A weighted name list with no name listed twice. */
function weightedNameList(minimum: number) {
  return z
    .array(weightedNameSchema)
    .min(minimum)
    .refine((names) => !hasDuplicates(names.map(([name]) => name)), {
      message: 'Each name may appear only once in a list',
    });
}

/**
 * How surnames are formed: `single` (one family name), `double` (two family names, for example
 * a father's and a mother's), `patronymic-free` (one family name, never derived from a parent's
 * given name).
 */
export const SURNAME_STYLES = ['single', 'double', 'patronymic-free'] as const;
export type SurnameStyle = (typeof SURNAME_STYLES)[number];

export const nameCultureRecord = defineRecordKind(
  z.strictObject({
    key: keySchema,
    /** A label for tools and the pack editor, never shown as a reference. */
    label: z.string().min(1).max(60),
    given: z.strictObject({
      male: weightedNameList(1),
      female: weightedNameList(1),
      /** Names used for anyone; may be empty. */
      neutral: weightedNameList(0),
    }),
    surnames: weightedNameList(1),
    surnameStyle: z.enum(SURNAME_STYLES),
    /**
     * For `double` cultures only, and required there: the chance (0-1) that a person gets two
     * surnames instead of one.
     */
    doubleSurnameChance: chanceSchema.optional(),
  }),
  (culture, context) => {
    if (culture.surnameStyle === 'double' && culture.doubleSurnameChance === undefined) {
      context.addIssue({
        code: 'custom',
        message: 'A culture with surnameStyle "double" must set doubleSurnameChance',
        path: ['doubleSurnameChance'],
      });
    }
    if (culture.surnameStyle !== 'double' && culture.doubleSurnameChance !== undefined) {
      context.addIssue({
        code: 'custom',
        message: `doubleSurnameChance only applies to surnameStyle "double", not "${culture.surnameStyle}"`,
        path: ['doubleSurnameChance'],
      });
    }
  },
);

export const countryNameMixRecord = defineRecordKind(
  z.strictObject({
    /** The same key as the country, so each country has at most one mix. */
    key: keySchema,
    countryKey: refSchema,
    cultures: z
      .array(
        z.strictObject({
          cultureKey: refSchema,
          weight: z.number().int().min(1).max(1000),
        }),
      )
      .min(1)
      .refine((cultures) => !hasDuplicates(cultures.map((culture) => culture.cultureKey)), {
        message: 'Each culture may appear only once in a mix',
      }),
  }),
  (mix, context) => {
    if (parseRef(mix.countryKey).key !== mix.key) {
      context.addIssue({
        code: 'custom',
        message: 'A country name mix uses its country key as its own key',
        path: ['key'],
      });
    }
  },
);

/** The placeholders a ring name pattern may use. */
export const RING_NAME_PLACEHOLDERS = ['given', 'family', 'adjective', 'noun', 'nickname'] as const;

const PLACEHOLDER_PATTERN = /\{([^{}]*)\}/g;

/** The placeholder names in a ring name pattern, in order: `{adjective} {noun}` → adjective, noun. */
export function placeholdersIn(pattern: string): string[] {
  return [...pattern.matchAll(PLACEHOLDER_PATTERN)].map((match) => match[1] ?? '');
}

export type RingNamePlaceholder = (typeof RING_NAME_PLACEHOLDERS)[number];

export function isRingNamePlaceholder(name: string): name is RingNamePlaceholder {
  return RING_NAME_PLACEHOLDERS.some((placeholder) => placeholder === name);
}

/** One ring name template: at least one placeholder, and only known ones. */
const ringNamePatternSchema = z
  .string()
  .min(1)
  .max(60)
  .superRefine((pattern, context) => {
    const placeholders = placeholdersIn(pattern);
    if (placeholders.length === 0) {
      context.addIssue({
        code: 'custom',
        message: 'A pattern needs at least one placeholder, such as {noun}',
      });
    }
    for (const placeholder of placeholders) {
      if (!isRingNamePlaceholder(placeholder)) {
        context.addIssue({
          code: 'custom',
          message: `Unknown placeholder {${placeholder}}; use ${RING_NAME_PLACEHOLDERS.map((name) => `{${name}}`).join(', ')}`,
        });
      }
    }
  });

const wordListSchema = z
  .array(z.string().min(1).max(30))
  .refine((words) => !hasDuplicates(words), { message: 'Each word may appear only once' });

export const ringNameWordsRecord = defineRecordKind(
  z.strictObject({
    key: keySchema,
    adjectives: wordListSchema,
    nouns: wordListSchema,
    nicknames: wordListSchema,
    /**
     * Weighted templates such as `["{adjective} {noun}", 30]` or `["\"{nickname}\" {family}", 5]`:
     * a pattern is picked with odds `weight / total`.
     */
    patterns: z
      .array(z.tuple([ringNamePatternSchema, z.number().int().min(1).max(1000)]))
      .min(1)
      .refine((patterns) => !hasDuplicates(patterns.map(([pattern]) => pattern)), {
        message: 'Each pattern may appear only once',
      }),
  }),
);

export type NameCultureRecord = z.output<typeof nameCultureRecord.full>;
export type CountryNameMixRecord = z.output<typeof countryNameMixRecord.full>;
export type RingNameWordsRecord = z.output<typeof ringNameWordsRecord.full>;

// ---------------------------------------------------------------------------------------------
// Reference fields, checked by the loader (WLD-02)

export const nameCultureReferences = [] as const satisfies readonly RecordReference[];

export const countryNameMixReferences = [
  { path: ['countryKey'], target: 'country' },
  { path: ['cultures', '[]', 'cultureKey'], target: 'nameCulture' },
] as const satisfies readonly RecordReference[];

export const ringNameWordsReferences = [] as const satisfies readonly RecordReference[];
