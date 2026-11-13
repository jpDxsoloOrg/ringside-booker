/**
 * Promotions: the companies that run shows.
 *
 * A promotion holds the company-level facts: its name and look, where it is based and popular,
 * prestige, cash, style, who owns and books it, its production levels and staff policies, and the
 * controller that runs it (D-07). People attach to it through `Employment` rows, never directly.
 */

import { z } from 'zod';
import type { PromotionId } from '../../core/ids';
import { ControllerSchema, CONTROLLER_PLAYER_REF } from '../controller';
import type { IntegrityIssue } from '../integrity';
import { zCents, zGameDate, zId, zImageRef, zStat, zYearMonth } from '../primitives';
import { defineTable } from '../table-def';
import { tableOf } from '../world';
import { PromotionStyleSchema } from './promotion-style';

export const PROMOTION_STATUSES = ['active', 'dormant', 'closed'] as const;
export const PromotionStatusSchema = z.enum(PROMOTION_STATUSES);
export type PromotionStatus = z.infer<typeof PromotionStatusSchema>;

/** Production areas, each with a level from `PRODUCTION_LEVEL_MIN` to `PRODUCTION_LEVEL_MAX`. */
export const PRODUCTION_AREAS = [
  'stage',
  'camera',
  'editing',
  'pyro',
  'music',
  'writing',
  'marketing',
  'backOffice',
] as const;
export type ProductionArea = (typeof PRODUCTION_AREAS)[number];

export const PRODUCTION_LEVEL_MIN = 0;
export const PRODUCTION_LEVEL_MAX = 10;

/** Staff policy areas, each with a tier from 0 (none) to 3 (best). */
export const POLICY_AREAS = ['catering', 'travel', 'medical'] as const;
export type PolicyArea = (typeof POLICY_AREAS)[number];

export const SHORT_NAME_PATTERN = /^[A-Z0-9]{2,8}$/;
export const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

const zProductionLevel = z.number().int().min(PRODUCTION_LEVEL_MIN).max(PRODUCTION_LEVEL_MAX);

export const ProductionSchema = z.strictObject({
  stage: zProductionLevel,
  camera: zProductionLevel,
  editing: zProductionLevel,
  pyro: zProductionLevel,
  music: zProductionLevel,
  writing: zProductionLevel,
  marketing: zProductionLevel,
  backOffice: zProductionLevel,
}) satisfies z.ZodType<Record<ProductionArea, number>>;

const zPolicyTier = z.literal([0, 1, 2, 3]);

export const PoliciesSchema = z.strictObject({
  catering: zPolicyTier,
  travel: zPolicyTier,
  medical: zPolicyTier,
});

/** Sparse regional popularity: a missing region reads as zero, so zero is never stored. */
const zRegionalPop = z.record(
  zId('region'),
  z.number().gt(0, 'Zero popularity is left out of the record, not stored').max(100),
);

/**
 * What a promotion's shows have gained it in each region this calendar month (EVT5-02), so the
 * monthly gain cap can hold across shows. Sparse like `regionalPop`: a region with no gain is left
 * out. When `month` is not the current month, the whole tally counts as empty.
 */
export const PopularityGainsSchema = z.strictObject({
  month: zYearMonth,
  byRegion: z.record(
    zId('region'),
    z.number().gt(0, 'A region with no gain is left out of the record, not stored').max(100),
  ),
});

export type PopularityGains = z.infer<typeof PopularityGainsSchema>;

export const PromotionSchema = z
  .strictObject({
    id: zId('promotion'),
    name: z.string().min(1).max(60),
    /** Two to eight uppercase letters or digits, for tight spaces such as a card header. */
    shortName: z.string().regex(SHORT_NAME_PATTERN, 'Expected 2-8 uppercase letters or digits'),
    logoRef: zImageRef,
    foundedOn: zGameDate,
    status: PromotionStatusSchema,
    homeRegionId: zId('region'),
    regionalPop: zRegionalPop,
    /** Popularity gained from shows per region this calendar month (EVT5-02). */
    popularityGains: PopularityGainsSchema,
    prestige: zStat,
    /** May be negative: a promotion can be in debt. */
    cash: zCents,
    style: PromotionStyleSchema,
    ownerPersonId: zId('person').nullable(),
    bookerPersonId: zId('person').nullable(),
    /** The parent of a developmental promotion, or null. */
    parentPromotionId: zId('promotion').nullable(),
    production: ProductionSchema,
    policies: PoliciesSchema,
    /** `#rrggbb`, used by placeholder logos. */
    color: z.string().regex(HEX_COLOR_PATTERN, 'Expected a hex colour such as #1a2b3c'),
    controller: ControllerSchema,
  })
  .refine((promotion) => promotion.parentPromotionId !== promotion.id, {
    message: 'A promotion cannot be its own parent',
    path: ['parentPromotionId'],
  });

export type Promotion = z.infer<typeof PromotionSchema>;
export type Production = z.infer<typeof ProductionSchema>;
export type Policies = z.infer<typeof PoliciesSchema>;

function compareText(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  return left > right ? 1 : 0;
}

/**
 * Every cycle in the developmental-parent chain, each listed once as its member IDs starting from
 * the smallest, in ascending order of that first ID.
 */
export function findParentCycles(
  parentOf: ReadonlyMap<PromotionId, PromotionId | null>,
): PromotionId[][] {
  const cycles: PromotionId[][] = [];
  const settled = new Set<PromotionId>();
  const sortedIds = [...parentOf.keys()].sort(compareText);
  for (const startId of sortedIds) {
    const pathIndex = new Map<PromotionId, number>();
    const path: PromotionId[] = [];
    let currentId: PromotionId | null = startId;
    while (currentId !== null && !settled.has(currentId) && !pathIndex.has(currentId)) {
      pathIndex.set(currentId, path.length);
      path.push(currentId);
      currentId = parentOf.get(currentId) ?? null;
    }
    const cycleStart = currentId === null ? undefined : pathIndex.get(currentId);
    if (cycleStart !== undefined) {
      const members = path.slice(cycleStart);
      const smallest = [...members].sort(compareText)[0];
      const rotateBy = smallest === undefined ? 0 : members.indexOf(smallest);
      cycles.push([...members.slice(rotateBy), ...members.slice(0, rotateBy)]);
    }
    for (const visitedId of path) {
      settled.add(visitedId);
    }
  }
  return cycles.sort((left, right) => compareText(left[0] ?? '', right[0] ?? ''));
}

export const promotionsTable = defineTable({
  kind: 'promotion',
  name: 'promotions',
  schema: PromotionSchema,
  refs: [
    { path: 'homeRegionId', target: 'region', nullable: false },
    { path: 'regionalPop{}', target: 'region', nullable: false },
    { path: 'popularityGains.byRegion{}', target: 'region', nullable: false },
    { path: 'ownerPersonId', target: 'person', nullable: true },
    { path: 'bookerPersonId', target: 'person', nullable: true },
    { path: 'parentPromotionId', target: 'promotion', nullable: true },
    CONTROLLER_PLAYER_REF,
  ],
  indexes: [{ name: 'byStatus', key: (promotion) => promotion.status }],
  invariants: [
    {
      name: 'noParentCycles',
      check(view): IntegrityIssue[] {
        const parentOf = new Map<PromotionId, PromotionId | null>();
        for (const promotion of tableOf(view, promotionsTable).values()) {
          parentOf.set(promotion.id, promotion.parentPromotionId);
        }
        const issues: IntegrityIssue[] = [];
        for (const cycle of findParentCycles(parentOf)) {
          const [firstId] = cycle;
          if (firstId === undefined) {
            continue;
          }
          issues.push({
            code: 'promotions.parentCycle',
            table: 'promotions',
            id: firstId,
            path: 'parentPromotionId',
            message: `Developmental parent chain loops: ${[...cycle, firstId].join(' -> ')}`,
          });
        }
        return issues;
      },
    },
  ],
});
