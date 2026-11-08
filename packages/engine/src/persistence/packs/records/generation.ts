/**
 * Generation records: the numbers the people generator (WLD-05, WLD-06) rolls new people from.
 *
 * - A **generation role** says, for one person role, who gets it (gender shares), how old they are
 *   at each career stage and how often each stage comes up, which attributes are the role's own
 *   skills and which are performer attributes, whether the role has a debut date, and what
 *   motivates people in it.
 * - A **generation style** gives one ring style's global weight, the promotion styles whose home
 *   regions favour it, its attribute modifiers, how hard it is on the body and how often its
 *   wrestlers wear a mask.
 * - A **body archetype** is a body shape: height and weight ranges, the build it produces, how
 *   women's and non-binary bodies scale from it, and how well it suits each ring style.
 * - A **body modifier** moves one attribute with height or weight past a threshold (heavy people
 *   lose stamina, tall people gain presence).
 * - A **generation profile** gives, for one role and career stage, the mean and spread of every
 *   attribute and how strongly each attribute follows the person's overall talent. The attribute
 *   block is keyed by the engine's attribute list, so a misspelt attribute fails here instead of
 *   being ignored.
 * - A **trait incidence** gives the chance that a generated person holds a trait. Which traits
 *   cannot be held together is not pack data: it comes from the engine's `EXCLUSIVE_TRAIT_PAIRS`.
 *
 * Design: docs/design/world-generation.md. Format: docs/design/data-packs.md.
 */

import { z } from 'zod';
import {
  ATTRIBUTE_GROUPS,
  AttributeKeySchema,
  BuildSchema,
  MotivationSchema,
  PersonRoleSchema,
  RingStyleSchema,
  TraitKeySchema,
  type AttributeKey,
} from '../../../model/entities/person';
import { PromotionStyleSchema } from '../../../model/entities/promotion-style';
import { hasDuplicates } from '../../../model/entities/unique';
import { chanceSchema, defineRecordKind, percentSchema } from '../fields';
import { keySchema, type RecordReference } from '../keys';

/** Largest standard deviation a profile may give an attribute. */
export const ATTRIBUTE_SD_MAX = 50;

/** Range of a role multiplier on a trait's base chance. */
export const ROLE_MULTIPLIER_MAX = 10;

/** Youngest and oldest age a career stage may cover. */
export const STAGE_AGE_MIN = 16;
export const STAGE_AGE_MAX = 80;

/** Largest relative weight a weighted pick in the generation records may use. */
export const GENERATION_WEIGHT_MAX = 1000;

/** How far a share table may be from summing to exactly 1. */
const SHARE_SUM_TOLERANCE = 0.001;

/**
 * The career stages a generated person can start at, youngest first. A stage sets the age range
 * and the attribute profile, so experience lives in the data rather than in code.
 */
export const CAREER_STAGES = ['rookie', 'prospect', 'established', 'veteran', 'legend'] as const;
export type CareerStage = (typeof CAREER_STAGES)[number];
export const CareerStageSchema = z.enum(CAREER_STAGES);

/** The crew attributes a role can name as its own skills. */
const ROLE_SKILL_KEYS: readonly AttributeKey[] = ATTRIBUTE_GROUPS.crew;

/** The in-ring and character attributes, which a role can name as performer attributes. */
const PERFORMER_KEYS: readonly AttributeKey[] = [
  ...ATTRIBUTE_GROUPS.inRing,
  ...ATTRIBUTE_GROUPS.character,
];

const weightSchema = z.number().min(0).max(GENERATION_WEIGHT_MAX);

/** A table of shares (0-1 each) that must add up to 1. */
function shareTable<Shape extends z.ZodRawShape>(shape: Shape) {
  return z.strictObject(shape).superRefine((shares, context) => {
    const values: unknown[] = Object.values(shares);
    const total = values.reduce<number>(
      (sum, share) => sum + (typeof share === 'number' ? share : 0),
      0,
    );
    if (Math.abs(total - 1) > SHARE_SUM_TOLERANCE) {
      context.addIssue({
        code: 'custom',
        message: `Shares must add up to 1, got ${String(Math.round(total * 10_000) / 10_000)}`,
      });
    }
  });
}

/** A whole-number age range, both ends included. */
export const ageRangeSchema = z
  .strictObject({
    min: z.number().int().min(STAGE_AGE_MIN).max(STAGE_AGE_MAX),
    max: z.number().int().min(STAGE_AGE_MIN).max(STAGE_AGE_MAX),
  })
  .refine((range) => range.min <= range.max, {
    message: 'min must not be greater than max',
    path: ['max'],
  });

/** A list of attribute keys with no repeats, each from `allowed`. */
function attributeList(allowed: readonly AttributeKey[], what: string, minimum: number) {
  return z
    .array(AttributeKeySchema)
    .min(minimum)
    .superRefine((keys, context) => {
      if (hasDuplicates(keys)) {
        context.addIssue({ code: 'custom', message: 'Each attribute may appear only once' });
      }
      keys.forEach((key, index) => {
        if (!allowed.includes(key)) {
          context.addIssue({
            code: 'custom',
            message: `${key} is not ${what} (expected one of ${allowed.join(', ')})`,
            path: [index],
          });
        }
      });
    });
}

/** When a role debuts: the spread of the debut age around the mean tunable, and its limits. */
export const debutRuleSchema = z
  .strictObject({
    /** Standard deviation of the debut age in years. */
    ageSd: z.number().min(0).max(10),
    /** Youngest debut age. Never below the engine's minimum debut age of 14. */
    minAge: z.number().int().min(14).max(STAGE_AGE_MAX),
    /** Oldest debut age. */
    maxAge: z.number().int().min(14).max(STAGE_AGE_MAX),
  })
  .refine((rule) => rule.minAge <= rule.maxAge, {
    message: 'minAge must not be greater than maxAge',
    path: ['maxAge'],
  });

export const generationRoleRecord = defineRecordKind(
  z.strictObject({
    key: keySchema,
    label: z.string().min(1).max(60),
    role: PersonRoleSchema,
    /**
     * True for wrestling roles: they get a ring style from the style weights (everyone else is a
     * `nonWrestler`) and can roll a natural standout.
     */
    performer: z.boolean(),
    genderShares: shareTable({ male: chanceSchema, female: chanceSchema, nonBinary: chanceSchema }),
    stageShares: shareTable({
      rookie: chanceSchema,
      prospect: chanceSchema,
      established: chanceSchema,
      veteran: chanceSchema,
      legend: chanceSchema,
    }),
    stageAges: z.strictObject({
      rookie: ageRangeSchema,
      prospect: ageRangeSchema,
      established: ageRangeSchema,
      veteran: ageRangeSchema,
      legend: ageRangeSchema,
    }),
    /** The crew attributes that are this role's own job. Empty for wrestlers and managers. */
    roleSkills: attributeList(ROLE_SKILL_KEYS, 'a crew attribute', 0),
    /** The in-ring and character attributes; a natural standout picks one of these. */
    performerAttributes: attributeList(PERFORMER_KEYS, 'an in-ring or character attribute', 1),
    /** How the debut date is rolled, or null when people in this role have none. */
    debut: debutRuleSchema.nullable(),
    /** Relative weight of each motivation; at least one above 0. */
    motivationWeights: z.record(MotivationSchema, weightSchema),
  }),
  (role, context) => {
    const weights: number[] = Object.values(role.motivationWeights);
    if (!weights.some((weight) => weight > 0)) {
      context.addIssue({
        code: 'custom',
        message: 'At least one motivation needs a weight above 0',
        path: ['motivationWeights'],
      });
    }
  },
);

export const generationStyleRecord = defineRecordKind(
  z.strictObject({
    key: keySchema,
    style: RingStyleSchema,
    /** Relative weight in the global style pick. `nonWrestler` is never picked for a wrestler. */
    weight: weightSchema,
    /** Home regions (or countries) preferring one of these promotion styles boost this style. */
    promotionStyles: z
      .array(PromotionStyleSchema)
      .refine((styles) => !hasDuplicates(styles), { message: 'Each style may appear only once' }),
    /** Points added to attributes, -30..30 each. */
    attributeModifiers: z.partialRecord(AttributeKeySchema, z.number().min(-30).max(30)),
    /** Multiplies the expected wear per year of experience, 0-3. */
    wearMultiplier: z.number().min(0).max(3),
    /** Chance a person of this style wears a mask, 0-1. */
    maskedChance: chanceSchema,
  }),
);

/** A height or weight range, both ends included. */
function measureRange(min: number, max: number) {
  return z
    .strictObject({ min: z.number().min(min).max(max), max: z.number().min(min).max(max) })
    .refine((range) => range.min <= range.max, {
      message: 'min must not be greater than max',
      path: ['max'],
    });
}

const bodyScaleSchema = z.strictObject({
  heightCm: z.number().min(0.5).max(1.5),
  weightKg: z.number().min(0.5).max(1.5),
});

export const bodyArchetypeRecord = defineRecordKind(
  z.strictObject({
    key: keySchema,
    label: z.string().min(1).max(60),
    build: BuildSchema,
    /** Height range in centimetres, before scaling and clamping. */
    heightCm: measureRange(100, 260),
    /** Weight range in kilograms, before scaling and clamping. */
    weightKg: measureRange(30, 300),
    /** Factors for women's and non-binary bodies. Men use the ranges as they are. */
    scale: z.strictObject({ female: bodyScaleSchema, nonBinary: bodyScaleSchema }),
    /** How well the archetype suits each ring style; 0 means never. Every style is required. */
    styleWeights: z.record(RingStyleSchema, weightSchema),
  }),
);

export const BODY_MEASURES = ['heightCm', 'weightKg'] as const;
export type BodyMeasure = (typeof BODY_MEASURES)[number];

export const bodyModifierRecord = defineRecordKind(
  z.strictObject({
    key: keySchema,
    label: z.string().min(1).max(60),
    attribute: AttributeKeySchema,
    measure: z.enum(BODY_MEASURES),
    /** Whether the modifier counts the amount above or below `from`. */
    direction: z.enum(['above', 'below']),
    /** The threshold, in centimetres or kilograms. */
    from: z.number().min(0).max(300),
    /** Points per centimetre or kilogram past the threshold; negative lowers the attribute. */
    perUnit: z.number().min(-5).max(5),
    /** The largest size of the effect in points, 0-50, whatever its sign. */
    limit: z.number().min(0).max(50),
  }),
);

export const attributeDistributionSchema = z.strictObject({
  /** Average value, 0-100. */
  mean: percentSchema,
  /** Standard deviation, 0-50. */
  sd: z.number().min(0).max(ATTRIBUTE_SD_MAX),
  /** How much the attribute follows the person's overall talent: 0 = not at all, 1 = fully. */
  talentWeight: chanceSchema,
});

export const generationProfileRecord = defineRecordKind(
  z.strictObject({
    key: keySchema,
    label: z.string().min(1).max(60),
    role: PersonRoleSchema,
    /** The career stage this profile is for. */
    stage: CareerStageSchema,
    /** One entry for every attribute; a missing or unknown attribute is an error. */
    attributes: z.record(AttributeKeySchema, attributeDistributionSchema),
  }),
);

export const traitIncidenceRecord = defineRecordKind(
  z.strictObject({
    key: keySchema,
    traitKey: TraitKeySchema,
    /** Chance a generated person holds the trait before role multipliers, 0-1. */
    baseChance: chanceSchema,
    /** Multiplies the base chance for people with that role, 0-10. Roles left out use 1. */
    roleMultipliers: z.partialRecord(PersonRoleSchema, z.number().min(0).max(ROLE_MULTIPLIER_MAX)),
    /** Youngest age at which the trait can be rolled. Left out = any age. */
    minAge: z.number().int().min(0).max(100).optional(),
  }),
);

export type AgeRange = z.output<typeof ageRangeSchema>;
export type DebutRule = z.output<typeof debutRuleSchema>;
export type GenerationRoleRecord = z.output<typeof generationRoleRecord.full>;
export type GenerationStyleRecord = z.output<typeof generationStyleRecord.full>;
export type BodyArchetypeRecord = z.output<typeof bodyArchetypeRecord.full>;
export type BodyModifierRecord = z.output<typeof bodyModifierRecord.full>;
export type AttributeDistribution = z.output<typeof attributeDistributionSchema>;
export type GenerationProfileRecord = z.output<typeof generationProfileRecord.full>;
export type TraitIncidenceRecord = z.output<typeof traitIncidenceRecord.full>;

// ---------------------------------------------------------------------------------------------
// Reference fields, checked by the loader (WLD-02). None of the generation records refer to other
// records: roles, styles, attributes and traits are engine lists, not pack records.

export const generationRoleReferences = [] as const satisfies readonly RecordReference[];

export const generationStyleReferences = [] as const satisfies readonly RecordReference[];

export const bodyArchetypeReferences = [] as const satisfies readonly RecordReference[];

export const bodyModifierReferences = [] as const satisfies readonly RecordReference[];

export const generationProfileReferences = [] as const satisfies readonly RecordReference[];

export const traitIncidenceReferences = [] as const satisfies readonly RecordReference[];
