/**
 * People records: people, their contracts, tag teams and title history.
 *
 * Field names follow the engine's person (FND-06) and employment, team and reign entities (FND-07,
 * FND-08) one for one, except that each `<thing>Id` is written `<thing>Key`. What a pack does not
 * say, the loader (WLD-02) fills in:
 *
 * - Transient person state starts clear: `fatigue` 0, no `injury`, no `restrictions`.
 * - Every employment in a pack is `active`, offered on its `startsOn`, with no leave, no
 *   appearances yet this year and a null momentum. Money is in whole currency units.
 * - A reign's `holderNamesAtTime` comes from each holder's ring name with the title's promotion.
 */

import { z } from 'zod';
import { ageInYears, compareDates, isBefore } from '../../../core/date';
import {
  AlignmentSchema,
  ContractKindSchema,
  EmploymentRoleSchema,
  PushSchema,
} from '../../../model/entities/employment';
import { isPresentIff } from '../../../model/entities/entity-refinements';
import {
  AttributesSchema,
  BodyConditionSchema,
  BuildSchema,
  CareerSchema,
  DevelopmentSchema,
  FAMILY_NAME_MAX_LENGTH,
  GenderSchema,
  GIVEN_NAME_MAX_LENGTH,
  HEIGHT_CM_MAX,
  HEIGHT_CM_MIN,
  MAX_TAGS,
  MIN_DEBUT_AGE,
  MotivationSchema,
  PersonRoleSchema,
  PersonStatusSchema,
  RING_NAME_MAX_LENGTH,
  RingStyleSchema,
  TAG_MAX_LENGTH,
  TraitsSchema,
  VicesSchema,
  WEIGHT_KG_MAX,
  WEIGHT_KG_MIN,
  WRESTLING_ROLES,
} from '../../../model/entities/person';
import { TEAM_SIZE, TeamKindSchema, TeamStatusSchema } from '../../../model/entities/team';
import { MAX_REIGN_HOLDERS, REIGN_END_REASONS } from '../../../model/entities/title-reign';
import { hasDuplicates } from '../../../model/entities/unique';
import {
  zBasisPoints,
  zContentKey,
  zImageRef,
  zNonNegativeInt,
  zPositiveInt,
  zSigned100,
} from '../../../model/primitives';
import {
  defineRecordKind,
  isoDateSchema,
  nonNegativeWholeMoneySchema,
  percentSchema,
  regionalPopSchema,
} from '../fields';
import { keySchema, parseRef, refListSchema, refSchema, type RecordReference } from '../keys';

// ---------------------------------------------------------------------------------------------
// People

export const personRecord = defineRecordKind(
  z.strictObject({
    key: keySchema,

    // Identity
    givenName: z.string().min(1).max(GIVEN_NAME_MAX_LENGTH),
    /** Empty for people known by one name. */
    familyName: z.string().max(FAMILY_NAME_MAX_LENGTH),
    defaultRingName: z.string().min(1).max(RING_NAME_MAX_LENGTH),
    gender: GenderSchema,
    birthDate: isoDateSchema,
    /** Null for someone who has not debuted yet. */
    debutDate: isoDateSchema.nullable(),
    birthRegionKey: refSchema,
    basedInRegionKey: refSchema,
    imageRef: zImageRef.optional(),
    /** Left out = false. */
    masked: z.boolean().optional(),
    /** Left out = no tags. */
    tags: z.array(z.string().min(1).max(TAG_MAX_LENGTH)).max(MAX_TAGS).optional(),

    // Roles and career
    roles: z
      .array(PersonRoleSchema)
      .min(1)
      .refine((roles) => !hasDuplicates(roles), { message: 'Roles must be unique' }),
    /** Left out = `active`. */
    status: PersonStatusSchema.optional(),
    /** Left out = can neither own nor book. */
    career: CareerSchema.optional(),
    motivation: MotivationSchema,

    // Physical
    heightCm: z.number().int().min(HEIGHT_CM_MIN).max(HEIGHT_CM_MAX),
    weightKg: z.number().int().min(WEIGHT_KG_MIN).max(WEIGHT_KG_MAX),
    build: BuildSchema,
    style: RingStyleSchema,

    /** Every attribute, 0-100; an attribute the engine does not know fails. */
    attributes: AttributesSchema,
    /** Every body part, 0-100. */
    condition: BodyConditionSchema,

    development: DevelopmentSchema,
    /** Popularity per region, 1-100; regions left out are 0. */
    regionalPop: regionalPopSchema,
    traits: TraitsSchema,
    vices: VicesSchema,
  }),
  (person, context) => {
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
    const wrestles = person.roles.some((role) =>
      WRESTLING_ROLES.some((wrestlingRole) => wrestlingRole === role),
    );
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
  },
);

// ---------------------------------------------------------------------------------------------
// Employments

/** Contract terms as the engine defines them, with money in whole currency units. */
export const contractTermsRecordSchema = z.strictObject({
  kind: ContractKindSchema,
  exclusive: z.boolean(),
  monthlyWage: nonNegativeWholeMoneySchema,
  perAppearanceFee: nonNegativeWholeMoneySchema,
  signingBonus: nonNegativeWholeMoneySchema,
  /** Revenue shares in basis points, 0-10000 (10000 = 100%). */
  shares: z.strictObject({
    gateBp: zBasisPoints,
    merchBp: zBasisPoints,
    broadcastBp: zBasisPoints,
  }),
  /** Most appearances per game year, or null for no cap. */
  appearanceCap: zPositiveInt.nullable(),
  perks: z.strictObject({
    creativeControl: z.boolean(),
    noHouseShows: z.boolean(),
    ironClad: z.boolean(),
    travelCovered: z.boolean(),
  }),
});

/** A contract running when the world starts. There is no status field: it is always `active`. */
export const employmentRecord = defineRecordKind(
  z.strictObject({
    key: keySchema,
    personKey: refSchema,
    promotionKey: refSchema,
    /** Left out or null = not assigned to a brand. */
    brandKey: refSchema.nullable().optional(),
    managerPersonKey: refSchema.nullable().optional(),
    role: EmploymentRoleSchema,
    ringName: z.string().min(1).max(RING_NAME_MAX_LENGTH),
    /** A gimmick catalog entry such as `gimmick.monster-heel`; left out or null = none. */
    gimmickKey: zContentKey.nullable().optional(),
    alignment: AlignmentSchema,
    push: PushSchema,
    terms: contractTermsRecordSchema,
    startsOn: isoDateSchema,
    /** Null = open-ended. */
    endsOn: isoDateSchema.nullable(),
    /** -100..100; left out = 0. */
    morale: zSigned100.optional(),
  }),
  (employment, context) => {
    if (employment.endsOn !== null && compareDates(employment.endsOn, employment.startsOn) <= 0) {
      context.addIssue({
        code: 'custom',
        message: 'endsOn must be after startsOn (or null for open-ended)',
        path: ['endsOn'],
      });
    }
    const managerKey = employment.managerPersonKey;
    if (
      managerKey !== undefined &&
      managerKey !== null &&
      parseRef(managerKey).key === parseRef(employment.personKey).key
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A person cannot be their own manager',
        path: ['managerPersonKey'],
      });
    }
    if (employment.terms.kind === 'perAppearance' && employment.terms.monthlyWage !== 0) {
      context.addIssue({
        code: 'custom',
        message: 'A per-appearance contract has no monthly wage',
        path: ['terms', 'monthlyWage'],
      });
    }
  },
);

// ---------------------------------------------------------------------------------------------
// Teams

/** A tag team or trio. Teams belong to no promotion, so there is no promotion key. */
export const teamRecord = defineRecordKind(
  z.strictObject({
    key: keySchema,
    kind: TeamKindSchema,
    name: z.string().min(1).max(60),
    memberKeys: refListSchema,
    formedOn: isoDateSchema,
    /** How well the team works together, 0-100; left out = 0. */
    experience: percentSchema.optional(),
    /** Left out = `active`. */
    status: TeamStatusSchema.optional(),
    /** Set exactly when the status is `split`. */
    splitOn: isoDateSchema.nullable().optional(),
  }),
  (team, context) => {
    const size = TEAM_SIZE[team.kind];
    if (team.memberKeys.length !== size) {
      context.addIssue({
        code: 'custom',
        message: `A ${team.kind} team has exactly ${String(size)} members`,
        path: ['memberKeys'],
      });
    }
    const splitOn = team.splitOn ?? null;
    if (!isPresentIff(splitOn, team.status === 'split')) {
      context.addIssue({
        code: 'custom',
        message: 'splitOn is set exactly when the status is split',
        path: ['splitOn'],
      });
    }
    if (splitOn !== null && compareDates(splitOn, team.formedOn) < 0) {
      context.addIssue({
        code: 'custom',
        message: 'splitOn must not be before formedOn',
        path: ['splitOn'],
      });
    }
  },
);

// ---------------------------------------------------------------------------------------------
// Title reigns

/** A title's past or current reign, for the history a world starts with. */
export const titleReignRecord = defineRecordKind(
  z.strictObject({
    key: keySchema,
    titleKey: refSchema,
    holderPersonKeys: refListSchema.min(1).max(MAX_REIGN_HOLDERS),
    /** The team that held the title, when it was won as a team. */
    teamKey: refSchema.nullable().optional(),
    wonOn: isoDateSchema,
    /** Null for the current reign. */
    lostOn: isoDateSchema.nullable(),
    /** Set exactly when `lostOn` is set. */
    endReason: z.enum(REIGN_END_REASONS).nullable(),
    defences: zNonNegativeInt,
  }),
  (reign, context) => {
    if (reign.lostOn !== null && compareDates(reign.lostOn, reign.wonOn) < 0) {
      context.addIssue({
        code: 'custom',
        message: 'lostOn must not be before wonOn',
        path: ['lostOn'],
      });
    }
    if (!isPresentIff(reign.endReason, reign.lostOn !== null)) {
      context.addIssue({
        code: 'custom',
        message: 'endReason is set exactly when lostOn is set',
        path: ['endReason'],
      });
    }
  },
);

export type PersonRecord = z.output<typeof personRecord.full>;
export type ContractTermsRecord = z.output<typeof contractTermsRecordSchema>;
export type EmploymentRecord = z.output<typeof employmentRecord.full>;
export type TeamRecord = z.output<typeof teamRecord.full>;
export type TitleReignRecord = z.output<typeof titleReignRecord.full>;

// ---------------------------------------------------------------------------------------------
// Reference fields, checked by the loader (WLD-02). `gimmickKey` is a content key, not a record.

export const personReferences = [
  { path: ['birthRegionKey'], target: 'region' },
  { path: ['basedInRegionKey'], target: 'region' },
  { path: ['regionalPop', '{}'], target: 'region' },
] as const satisfies readonly RecordReference[];

export const employmentReferences = [
  { path: ['personKey'], target: 'person' },
  { path: ['promotionKey'], target: 'promotion' },
  { path: ['brandKey'], target: 'brand' },
  { path: ['managerPersonKey'], target: 'person' },
] as const satisfies readonly RecordReference[];

export const teamReferences = [
  { path: ['memberKeys', '[]'], target: 'person' },
] as const satisfies readonly RecordReference[];

export const titleReignReferences = [
  { path: ['titleKey'], target: 'title' },
  { path: ['holderPersonKeys', '[]'], target: 'person' },
  { path: ['teamKey'], target: 'team' },
] as const satisfies readonly RecordReference[];
