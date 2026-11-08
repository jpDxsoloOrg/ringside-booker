/**
 * The two hand-written inputs of the default roster build, as zod schemas:
 *
 * - `content/worlds/default/roster.spec.json`: how many people each promotion gets and of what
 *   kind, the free-agent pool, the placeholder contract table and the knobs of each build step.
 * - `content/worlds/default/headliners.json`: the hand-authored stars, each with a contract stub
 *   and, for the singles champions, the title they hold on day one.
 *
 * Neither file is a pack file: the pack loader never reads them. The build turns them into the
 * pack files (`people.json`, `employments.json`, `teams.json`, `reigns.json`).
 *
 * Design: docs/design/default-world.md#the-roster.
 */

import {
  ALIGNMENTS,
  ATTRIBUTE_KEYS,
  CAREER_STAGES,
  GENDERS,
  RING_STYLES,
  type AttributeKey,
  type RingStyle,
} from '@ringside/engine';
import { z } from 'zod';

/** The size tiers of the default world, biggest first. */
export const TIERS = ['flagship', 'national', 'regional', 'local'] as const;
export type Tier = (typeof TIERS)[number];

/** The card positions a wrestler can hold, top of the card first. */
export const CARD_PUSHES = [
  'mainEvent',
  'upperCard',
  'midCard',
  'lowerCard',
  'enhancement',
] as const;
export type CardPush = (typeof CARD_PUSHES)[number];

/** Non-wrestling jobs a promotion fills from the spec, in the order they are generated. */
export const STAFF_ROLES = ['referee', 'announcer', 'producer', 'manager'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

/** Wrestling styles only: `nonWrestler` is never rolled for a wrestler. */
export const WRESTLING_STYLES = RING_STYLES.filter(
  (style): style is Exclude<RingStyle, 'nonWrestler'> => style !== 'nonWrestler',
);

const KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const keySchema = z.string().regex(KEY_PATTERN);

const share = z.number().min(0).max(1);
const weight = z.number().min(0);

/** True when shares add up to 1 (within rounding). */
function addsUpToOne(shares: Readonly<Record<string, number>>): boolean {
  const total = Object.values(shares).reduce((sum, value) => sum + value, 0);
  return Math.abs(total - 1) < 1e-6;
}

const SHARES_MESSAGE = { message: 'Shares must add up to 1' };

function rangeOf(min: number, max: number) {
  return z
    .strictObject({ min: z.number().min(min).max(max), max: z.number().min(min).max(max) })
    .refine((range) => range.min <= range.max, { message: 'min must not be above max' });
}

const genderShares = z
  .strictObject({ male: share, female: share, nonBinary: share })
  .refine(addsUpToOne, SHARES_MESSAGE);
const stageShares = z
  .strictObject({
    rookie: share,
    prospect: share,
    established: share,
    veteran: share,
    legend: share,
  })
  .refine(addsUpToOne, SHARES_MESSAGE);
const pushShares = z
  .strictObject({
    mainEvent: share,
    upperCard: share,
    midCard: share,
    lowerCard: share,
    enhancement: share,
  })
  .refine(addsUpToOne, SHARES_MESSAGE);

const staffCounts = z.strictObject({
  referee: z.number().int().min(1).max(4),
  announcer: z.number().int().min(1).max(3),
  producer: z.number().int().min(0).max(3),
  manager: z.number().int().min(0).max(3),
});

const freeAgentStaffCounts = z.strictObject({
  referee: z.number().int().min(0).max(10),
  announcer: z.number().int().min(0).max(10),
  producer: z.number().int().min(0).max(10),
  manager: z.number().int().min(0).max(10),
});

/** Ring style weights: a full table used instead of the generator's own pick when given. */
const styleWeights = z
  .partialRecord(z.enum(WRESTLING_STYLES), weight)
  .refine((weights) => Object.values(weights).some((value) => value > 0), {
    message: 'At least one style needs a weight above 0',
  });

const promotionSpec = z.strictObject({
  tier: z.enum(TIERS),
  wrestlers: z.number().int().min(1).max(80),
  genderShares,
  pushShares,
  stageShares,
  /** Left out: the generator picks the style from the home region's taste. */
  styleWeights: styleWeights.optional(),
  staff: staffCounts,
  /** Months after the world starts that a contract runs out, spread uniformly. */
  contractMonths: rangeOf(1, 60),
  /** Brand → share of the generated wrestlers; left out = no brands. */
  brandShares: z.record(keySchema, share).optional(),
});

/** One tier's placeholder pay: the contract kind and an amount per push (`none` for staff). */
const tierTerms = z.strictObject({
  kind: z.enum(['written', 'perAppearance']),
  /** Monthly wage for a written deal, per-appearance fee for a per-appearance deal. */
  pay: z.strictObject({
    mainEvent: z.number().int().min(0),
    upperCard: z.number().int().min(0),
    midCard: z.number().int().min(0),
    lowerCard: z.number().int().min(0),
    enhancement: z.number().int().min(0),
    none: z.number().int().min(0),
  }),
});

export const rosterSpecSchema = z.strictObject({
  /** The seed every random draw of the build comes from. */
  seed: z.string().min(1),
  /** The share of a promotion's generated people born in a neighbouring country. */
  neighbourCountryShare: share,
  promotions: z.record(keySchema, promotionSpec),
  freeAgents: z.strictObject({
    wrestlers: z.number().int().min(0).max(200),
    genderShares,
    stageShares,
    staff: freeAgentStaffCounts,
    /** Continent key → weight for where free agents come from. */
    continentWeights: z.record(keySchema, weight),
    /** Tag teams formed from free agents. */
    teams: z.number().int().min(0).max(20),
  }),
  cardValue: z.strictObject({
    /** Weight of home popularity in the card value (added to the mean performer attribute). */
    homePopularityWeight: z.number().min(0).max(5),
  }),
  alignment: z.strictObject({
    /** Chance that a face/heel pair down the push order is swapped. */
    swapChance: share,
  }),
  popularity: z.strictObject({
    /** A promotion's popularity a region needs before its workers are fitted there. */
    minPromotionPopularity: z.number().min(0).max(100),
    /** Share of the promotion's popularity a worker at each push is raised to. */
    pushFactors: z.strictObject({
      mainEvent: share,
      upperCard: share,
      midCard: share,
      lowerCard: share,
      enhancement: share,
    }),
    /** Uniform noise on the fitted value, as a share (0.1 = ±10%). */
    noise: z.number().min(0).max(0.5),
  }),
  contracts: z.strictObject({
    /** How long before the world start a running contract began, in years. */
    startedYearsAgo: rangeOf(0, 20),
    terms: z.strictObject({
      flagship: tierTerms,
      national: tierTerms,
      regional: tierTerms,
      local: tierTerms,
    }),
  }),
  teams: z.strictObject({
    /** Teams per promotion with a tag or trios title. */
    perPromotion: rangeOf(1, 10),
    /** How long before the world start a team formed, in months. */
    formedMonthsAgo: rangeOf(1, 240),
    /** Style groups: two styles that share a group make a compatible team. */
    styleGroups: z.record(keySchema, z.array(z.enum(WRESTLING_STYLES)).min(1)),
    /** Starting team experience, 0-100. */
    experience: rangeOf(0, 100),
  }),
  reigns: z.strictObject({
    /** Days before the world start that the current champion won the title. */
    currentWonDaysAgo: rangeOf(1, 3650),
    defences: rangeOf(0, 100),
    /** Past reigns per title. */
    pastReigns: rangeOf(0, 20),
    /** How far back the history goes, in years. */
    historyYears: z.number().min(0).max(50),
    /** Length of a past reign, in days. */
    pastReignDays: rangeOf(1, 3650),
    /** Chance a past reign goes to a headliner of another promotion. */
    otherPromotionHolderChance: share,
  }),
});

export type RosterSpec = z.output<typeof rosterSpecSchema>;
export type PromotionSpec = z.output<typeof promotionSpec>;
export type TierTerms = z.output<typeof tierTerms>;
export type Range = z.output<ReturnType<typeof rangeOf>>;

const attributeOverrides = z.partialRecord(z.enum(ATTRIBUTE_KEYS), z.number().min(0).max(100));

/** A hand-authored star: who they are, and the contract they start the game on. */
export const headlinerSchema = z.strictObject({
  key: keySchema,
  givenName: z.string().min(1).max(40),
  familyName: z.string().max(40),
  ringName: z.string().min(1).max(60),
  gender: z.enum(GENDERS),
  /** Whole years on the world's start date. */
  age: z.number().int().min(18).max(60),
  careerStage: z.enum(CAREER_STAGES),
  /** Where they were born and grew up. */
  homeRegionKey: keySchema,
  style: z.enum(WRESTLING_STYLES),
  /** A body archetype key; left out = rolled for the style. */
  archetype: keySchema.optional(),
  heightCm: z.number().int().min(140).max(230).optional(),
  weightKg: z.number().int().min(40).max(250).optional(),
  masked: z.boolean().optional(),
  /** Talent z-score: how far above an average worker of their stage they are. */
  talent: z.number().min(-3).max(4),
  attributeOverrides: attributeOverrides.optional(),
  employment: z.strictObject({
    promotionKey: keySchema,
    brandKey: keySchema.nullable().optional(),
    push: z.enum(CARD_PUSHES),
    alignment: z.enum(ALIGNMENTS),
  }),
  /** The singles title they hold when the world starts. */
  holdsTitleKey: keySchema.optional(),
});

export const headlinersSchema = z.array(headlinerSchema).superRefine((headliners, context) => {
  const seen = new Set<string>();
  headliners.forEach((headliner, index) => {
    if (seen.has(headliner.key)) {
      context.addIssue({
        code: 'custom',
        message: `Key ${headliner.key} is repeated`,
        path: [index],
      });
    }
    seen.add(headliner.key);
  });
});

export type Headliner = z.output<typeof headlinerSchema>;
export type AttributeOverrides = Partial<Record<AttributeKey, number>>;
