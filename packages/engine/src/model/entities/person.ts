/**
 * The person: everyone in the world, wrestlers and crew alike.
 *
 * A person row holds what is true of someone wherever they work: identity, roles, physical
 * profile, the core attributes, body condition, transient state (fatigue, injury, restrictions),
 * the hidden development fields, regional popularity, traits and vices. Anything that exists only
 * because someone is employed (ring name per promotion, push, alignment, morale, momentum) lives on
 * the employment row instead (FND-07).
 *
 * This module fixes the shape and the ranges. What the numbers mean over time (growth, aging,
 * injuries, popularity drift) is designed by the WRK epic. See the People section of
 * `docs/design/data-model.md`.
 */

import { z } from 'zod';
import { ageInYears, isBefore } from '../../core/date';
import { zContentKey, zGameDate, zId, zImageRef, zStat } from '../primitives';
import { defineTable } from '../table-def';

// ---------------------------------------------------------------------------------------------
// Attributes

/**
 * The core attribute set, in display order: in-ring, then character, then crew. Every attribute is
 * a 0-100 float; the UI rounds for display.
 */
export const ATTRIBUTE_KEYS = [
  'ringwork',
  'psychology',
  'stamina',
  'safety',
  'athleticism',
  'mic',
  'charisma',
  'presence',
  'officiating',
  'broadcasting',
  'producing',
  'booking',
] as const;

export type AttributeKey = (typeof ATTRIBUTE_KEYS)[number];

/** The attributes by group, for screens and generators that list them in sections. */
export const ATTRIBUTE_GROUPS = {
  inRing: ['ringwork', 'psychology', 'stamina', 'safety', 'athleticism'],
  character: ['mic', 'charisma', 'presence'],
  crew: ['officiating', 'broadcasting', 'producing', 'booking'],
} as const satisfies Readonly<Record<string, readonly AttributeKey[]>>;

export type AttributeGroup = keyof typeof ATTRIBUTE_GROUPS;

export const AttributeKeySchema = z.enum(ATTRIBUTE_KEYS);

/** Every attribute is required. A non-wrestler simply has low in-ring values. */
export const AttributesSchema = z.record(AttributeKeySchema, zStat);

export type Attributes = z.infer<typeof AttributesSchema>;

// ---------------------------------------------------------------------------------------------
// Enums

export const GENDERS = ['male', 'female', 'nonBinary'] as const;
export type Gender = (typeof GENDERS)[number];
export const GenderSchema = z.enum(GENDERS);

export const PERSON_ROLES = [
  'wrestler',
  'occasionalWrestler',
  'manager',
  'presenter',
  'announcer',
  'referee',
  'producer',
] as const;
export type PersonRole = (typeof PERSON_ROLES)[number];
export const PersonRoleSchema = z.enum(PERSON_ROLES);

/** The roles that make someone a wrestler, which every person with a ring style must hold. */
export const WRESTLING_ROLES = [
  'wrestler',
  'occasionalWrestler',
] as const satisfies readonly PersonRole[];

export const PERSON_STATUSES = [
  'active',
  'semiRetired',
  'hiatus',
  'retired',
  'deceased',
  'outOfBusiness',
] as const;
export type PersonStatus = (typeof PERSON_STATUSES)[number];
export const PersonStatusSchema = z.enum(PERSON_STATUSES);

export const MOTIVATIONS = ['money', 'legacy', 'power', 'enjoyment', 'thrill'] as const;
export type Motivation = (typeof MOTIVATIONS)[number];
export const MotivationSchema = z.enum(MOTIVATIONS);

export const BUILDS = [
  'slim',
  'lean',
  'average',
  'athletic',
  'muscular',
  'stocky',
  'heavy',
  'superHeavy',
] as const;
export type Build = (typeof BUILDS)[number];
export const BuildSchema = z.enum(BUILDS);

export const RING_STYLES = [
  'allRounder',
  'technician',
  'brawler',
  'highFlyer',
  'powerhouse',
  'hardcore',
  'striker',
  'grappler',
  'showman',
  'nonWrestler',
] as const;
export type RingStyle = (typeof RING_STYLES)[number];
export const RingStyleSchema = z.enum(RING_STYLES);

export const BODY_PARTS = ['head', 'neck', 'back', 'arms', 'torso', 'legs'] as const;
export type BodyPart = (typeof BODY_PARTS)[number];
export const BodyPartSchema = z.enum(BODY_PARTS);

/** `hidden` means the player's promotion has not discovered the vice yet. */
export const VICE_STATES = ['none', 'hidden', 'known', 'recovering'] as const;
export type ViceState = (typeof VICE_STATES)[number];
export const ViceStateSchema = z.enum(VICE_STATES);

export const RESTRICTION_KINDS = ['rehab', 'personalLeave'] as const;
export type RestrictionKind = (typeof RESTRICTION_KINDS)[number];
export const RestrictionKindSchema = z.enum(RESTRICTION_KINDS);

// ---------------------------------------------------------------------------------------------
// Traits

/** The closed trait list, by group. Groups are for display and for the consumer list in the doc. */
export const TRAIT_GROUPS = {
  learning: ['fastLearner', 'slowLearner'],
  aging: ['agesWell', 'agesBadly'],
  body: ['durable', 'injuryProne'],
  effort: ['workhorse', 'coaster'],
  bigStage: ['bigMatchPerformer', 'shrinksOnBigStage'],
  selling: ['generousSeller', 'poorSeller'],
  ringCraft: ['tagSpecialist', 'teacher', 'improviser'],
  lockerRoom: [
    'leader',
    'professional',
    'troublemaker',
    'partier',
    'prankster',
    'sensitive',
    'egotist',
    'selfless',
  ],
  career: ['loyal', 'journeyman'],
  content: ['lovesHardcore', 'refusesHardcore', 'lovesComedy', 'refusesComedy'],
  character: ['naturalHeel', 'naturalFace'],
} as const;

export type TraitGroup = keyof typeof TRAIT_GROUPS;
export type TraitKey = (typeof TRAIT_GROUPS)[TraitGroup][number];

/** Every trait key, in group order. */
export const TRAIT_KEYS: readonly TraitKey[] = Object.values(TRAIT_GROUPS).flat();

/** Pairs no person may hold together. */
export const EXCLUSIVE_TRAIT_PAIRS = [
  ['fastLearner', 'slowLearner'],
  ['agesWell', 'agesBadly'],
  ['durable', 'injuryProne'],
  ['workhorse', 'coaster'],
  ['bigMatchPerformer', 'shrinksOnBigStage'],
  ['generousSeller', 'poorSeller'],
  ['professional', 'troublemaker'],
  ['egotist', 'selfless'],
  ['loyal', 'journeyman'],
  ['lovesHardcore', 'refusesHardcore'],
  ['lovesComedy', 'refusesComedy'],
  ['naturalHeel', 'naturalFace'],
] as const satisfies readonly (readonly [TraitKey, TraitKey])[];

export const TraitKeySchema = z.enum(TRAIT_KEYS);

// ---------------------------------------------------------------------------------------------
// Ranges

export const GIVEN_NAME_MAX_LENGTH = 40;
export const FAMILY_NAME_MAX_LENGTH = 40;
export const RING_NAME_MAX_LENGTH = 60;
export const MAX_TAGS = 10;
export const TAG_MAX_LENGTH = 24;
export const HEIGHT_CM_MIN = 140;
export const HEIGHT_CM_MAX = 230;
export const WEIGHT_KG_MIN = 40;
export const WEIGHT_KG_MAX = 250;
export const MAX_RESTRICTIONS = 4;
export const MAX_TRAITS = 8;
/** The youngest age at which anyone can debut. */
export const MIN_DEBUT_AGE = 14;
/** The potential scale is a placeholder that the WRK epic may change with a migration. */
export const POTENTIAL_MIN = -1000;
export const POTENTIAL_MAX = 1000;

// ---------------------------------------------------------------------------------------------
// Sub-schemas

function hasDuplicates(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}

/** Condition per body part; 100 is perfect health. Every part is required. */
export const BodyConditionSchema = z.record(BodyPartSchema, zStat);
export type BodyCondition = z.infer<typeof BodyConditionSchema>;

export const CareerSchema = z.strictObject({
  /** Can own a promotion. */
  canOwn: z.boolean(),
  /** Can be a promotion's booker. */
  canBook: z.boolean(),
});
export type Career = z.infer<typeof CareerSchema>;

export const InjurySchema = z
  .strictObject({
    /** The injury catalog entry, such as `injury.torn-acl`. */
    kindKey: zContentKey,
    bodyPart: BodyPartSchema,
    since: zGameDate,
    expectedReturn: zGameDate,
    /** Can still appear in non-wrestling segments while injured. */
    canWorkAngles: z.boolean(),
  })
  .refine((injury) => !isBefore(injury.expectedReturn, injury.since), {
    message: 'expectedReturn must not be before since',
    path: ['expectedReturn'],
  });
export type Injury = z.infer<typeof InjurySchema>;

/**
 * A spell during which the person cannot work. Suspensions and paid time off belong to an
 * employment (FND-07), not to the person.
 */
export const RestrictionSchema = z.strictObject({
  kind: RestrictionKindSchema,
  until: zGameDate,
});
export type Restriction = z.infer<typeof RestrictionSchema>;

/**
 * Hidden development fields. FND only fixes the ranges; the WRK epic owns what they mean (how
 * potential drains and gates growth and decline, and how ceilings cap attributes).
 */
export const DevelopmentSchema = z.strictObject({
  potential: z.number().int().min(POTENTIAL_MIN).max(POTENTIAL_MAX),
  ceilings: z.partialRecord(AttributeKeySchema, zStat),
});
export type Development = z.infer<typeof DevelopmentSchema>;

/**
 * Popularity per region, sparse: a missing region reads as 0, and an explicit 0 is refused so
 * saves stay small. Country and continent figures are derived by WRK queries, never stored.
 */
export const RegionalPopSchema = z
  .record(zId('region'), zStat)
  .superRefine((regionalPop, context) => {
    for (const [regionId, popularity] of Object.entries(regionalPop)) {
      if (popularity === 0) {
        context.addIssue({
          code: 'custom',
          message: `Leave region ${regionId} out instead of storing 0 popularity`,
          path: [regionId],
        });
      }
    }
  });
export type RegionalPop = z.infer<typeof RegionalPopSchema>;

export const TraitsSchema = z
  .array(TraitKeySchema)
  .max(MAX_TRAITS)
  .superRefine((traits, context) => {
    if (hasDuplicates(traits)) {
      context.addIssue({ code: 'custom', message: 'Traits must be unique' });
    }
    const held = new Set<TraitKey>(traits);
    for (const [first, second] of EXCLUSIVE_TRAIT_PAIRS) {
      if (held.has(first) && held.has(second)) {
        context.addIssue({
          code: 'custom',
          message: `Traits ${first} and ${second} cannot be held together`,
        });
      }
    }
  });

export const VicesSchema = z.strictObject({
  alcohol: ViceStateSchema,
  substances: ViceStateSchema,
});
export type Vices = z.infer<typeof VicesSchema>;

// ---------------------------------------------------------------------------------------------
// The person

function isWrestlingRole(role: PersonRole): boolean {
  return WRESTLING_ROLES.some((wrestlingRole) => wrestlingRole === role);
}

export const PersonSchema = z
  .strictObject({
    id: zId('person'),

    // Identity
    givenName: z.string().min(1).max(GIVEN_NAME_MAX_LENGTH),
    /** Empty for people known by one name. */
    familyName: z.string().max(FAMILY_NAME_MAX_LENGTH),
    /** The ring name used when no employment gives another one. */
    defaultRingName: z.string().min(1).max(RING_NAME_MAX_LENGTH),
    gender: GenderSchema,
    birthDate: zGameDate,
    /** Null until the person debuts. */
    debutDate: zGameDate.nullable(),
    birthRegionId: zId('region'),
    basedInRegionId: zId('region'),
    imageRef: zImageRef,
    masked: z.boolean(),
    /** Free labels such as `generated`. */
    tags: z.array(z.string().min(1).max(TAG_MAX_LENGTH)).max(MAX_TAGS),

    // Roles and career
    roles: z
      .array(PersonRoleSchema)
      .min(1)
      .refine((roles) => !hasDuplicates(roles), { message: 'Roles must be unique' }),
    status: PersonStatusSchema,
    career: CareerSchema,
    motivation: MotivationSchema,

    // Physical
    heightCm: z.number().int().min(HEIGHT_CM_MIN).max(HEIGHT_CM_MAX),
    weightKg: z.number().int().min(WEIGHT_KG_MIN).max(WEIGHT_KG_MAX),
    build: BuildSchema,
    style: RingStyleSchema,

    attributes: AttributesSchema,
    condition: BodyConditionSchema,

    // Transient state
    fatigue: zStat,
    injury: InjurySchema.nullable(),
    restrictions: z.array(RestrictionSchema).max(MAX_RESTRICTIONS),

    development: DevelopmentSchema,
    regionalPop: RegionalPopSchema,
    traits: TraitsSchema,
    vices: VicesSchema,
  })
  .superRefine((person, context) => {
    if (person.debutDate !== null) {
      const debutTooEarly =
        isBefore(person.debutDate, person.birthDate) ||
        ageInYears(person.birthDate, person.debutDate) < MIN_DEBUT_AGE;
      if (debutTooEarly) {
        context.addIssue({
          code: 'custom',
          message: `debutDate must be at least ${String(MIN_DEBUT_AGE)} years after birthDate`,
          path: ['debutDate'],
        });
      }
    }

    const wrestles = person.roles.some(isWrestlingRole);
    if (person.style !== 'nonWrestler' && !wrestles) {
      context.addIssue({
        code: 'custom',
        message: `A person with ring style ${person.style} needs the wrestler or occasionalWrestler role`,
        path: ['roles'],
      });
    }
    if (person.style === 'nonWrestler' && wrestles) {
      context.addIssue({
        code: 'custom',
        message: 'A nonWrestler cannot hold the wrestler or occasionalWrestler role',
        path: ['style'],
      });
    }

    if (person.status === 'deceased') {
      if (person.injury !== null) {
        context.addIssue({
          code: 'custom',
          message: 'A deceased person cannot have an injury',
          path: ['injury'],
        });
      }
      if (person.restrictions.length > 0) {
        context.addIssue({
          code: 'custom',
          message: 'A deceased person cannot have restrictions',
          path: ['restrictions'],
        });
      }
    }
  });

export type Person = z.infer<typeof PersonSchema>;

// ---------------------------------------------------------------------------------------------
// Table

export const peopleTable = defineTable({
  kind: 'person',
  name: 'people',
  schema: PersonSchema,
  refs: [
    { path: 'birthRegionId', target: 'region', nullable: false },
    { path: 'basedInRegionId', target: 'region', nullable: false },
    { path: 'regionalPop{}', target: 'region', nullable: false },
  ],
  indexes: [
    { name: 'byStatus', key: (person) => person.status },
    { name: 'byRole', key: (person) => person.roles },
    { name: 'byBasedInRegion', key: (person) => person.basedInRegionId },
  ],
});
