/**
 * Applying one completed show to its promotion's popularity (EVT5-02).
 *
 * Runs right after `show.completed`, for player and rival shows alike: works out which regions the
 * show reached, what fans there expected and how far popularity moves in each, then writes every
 * region in one call to the popularity door, so the clamps, the stored two decimals, the door's
 * trace and `popularity.changed` are the same as for any other popularity change. It then keeps the
 * month's gain tally on the promotion, stores the per-show record the results page reads, records
 * one Why? trace per region and publishes `showPopularity.changed`.
 *
 * It never touches morale, momentum, prestige or cash, and it rolls nothing.
 * Design: docs/design/promotion-popularity.md#after-every-show.
 */

import { yearMonthOf } from '../../core/date';
import type { EventInstanceId, RegionId } from '../../core/ids';
import type { StepContext } from '../../core/pipeline/context';
import type { Traced } from '../../core/trace';
import type { PopularityShowRegion } from '../../model/entities/popularity-show-change';
import type { Promotion } from '../../model/entities/promotion';
import { compareIds } from '../../model/table';
import type { DeepReadonly } from '../../model/world';
import { applyPopularityChange } from '../workers/doors';
import { createPopularityRoller } from '../world/formulas/popularityRollup';
import { geographyOf, type Geography } from '../world/geography';
import { regionExpectation } from './formulas/regionExpectation';
import { showPopularityChange } from './formulas/showPopularityChange';
import { showReach, type ReachedRegion } from './formulas/showReach';
import { reachInputsFor } from './reach';
import { showChangeTraceRef } from './traces';

/** The reason key the door and its `popularity.changed` event carry for a show's change. */
export const SHOW_RESULT_REASON_KEY = 'show.result';

/** The start of the trace line the monthly gain cap writes (`showPopularityChange`). */
const MONTHLY_CAP_LABEL = 'Monthly gain cap';

/** Popularity is stored in hundredths of a point; the gain tally is kept the same way. */
const HUNDREDTHS = 100;
const GAINS_MAX = 100;

/** What `applyShowPopularity` did: applied, or skipped and why. */
export interface ApplyShowPopularityResult {
  applied: boolean;
  /** Why nothing was written, when `applied` is false. */
  reason?: string;
}

/** One reached region, worked out before anything is written. */
interface RegionPlan {
  reached: ReachedRegion;
  before: number;
  expectation: Traced<number>;
  change: Traced<number>;
  capped: boolean;
}

function roundHundredths(value: number): number {
  return Math.round(value * HUNDREDTHS) / HUNDREDTHS;
}

/** True when the change's monthly gain cap line made the gain smaller, including down to 0. */
function cappedByMonth(change: Traced<number>): boolean {
  return (change.trace.children ?? []).some(
    (node) => node.kind === 'min' && node.label.startsWith(MONTHLY_CAP_LABEL) && node.applied,
  );
}

/** The month's gains so far: empty when the stored tally is for another month. */
export function gainsForMonth(
  promotion: Pick<DeepReadonly<Promotion>, 'popularityGains'>,
  date: Parameters<typeof yearMonthOf>[0],
): Readonly<Record<RegionId, number>> {
  return promotion.popularityGains.month === yearMonthOf(date)
    ? promotion.popularityGains.byRegion
    : {};
}

/** The reached regions, most populous first (ties by id): the order the door writes them in. */
function byPopulation(
  regions: readonly ReachedRegion[],
  geography: Geography,
): readonly ReachedRegion[] {
  return [...regions].sort(
    (left, right) =>
      geography.region(right.regionId).population - geography.region(left.regionId).population ||
      compareIds(left.regionId, right.regionId),
  );
}

function skip(ctx: StepContext, eventInstanceId: EventInstanceId, reason: string) {
  ctx.log(`promoPop: no popularity change for show ${eventInstanceId}: ${reason}`);
  return { applied: false, reason } satisfies ApplyShowPopularityResult;
}

/**
 * Moves the show's promotion's popularity in every region the show reached, by the amounts
 * EVT5-01's formulas give, through one call to the popularity door. Skips (and logs why, writing
 * nothing) a show that is not completed, has no result, belongs to a promotion that is not active,
 * or has already been applied.
 */
export function applyShowPopularity(
  ctx: StepContext,
  eventInstanceId: EventInstanceId,
): ApplyShowPopularityResult {
  const { read, tunables } = ctx;
  const instance = read.tables.eventInstances.get(eventInstanceId);
  if (instance === undefined) {
    return skip(ctx, eventInstanceId, 'the show does not exist');
  }
  if (instance.status !== 'completed') {
    return skip(ctx, eventInstanceId, `the show is ${instance.status}, not completed`);
  }
  if (instance.result === null) {
    return skip(ctx, eventInstanceId, 'the show has no result');
  }
  const promotion = read.tables.promotions.get(instance.promotionId);
  if (promotion?.status !== 'active') {
    return skip(ctx, eventInstanceId, 'its promotion is not active');
  }
  if (read.tables.popularityShowChanges.lookup('byEventInstance', instance.id).length > 0) {
    return skip(ctx, eventInstanceId, 'it has already been applied');
  }

  const geography = geographyOf(read);
  const reach = showReach(reachInputsFor(read, instance, geography), { tunables });
  const gains = gainsForMonth(promotion, instance.date);
  const score = instance.result.score;

  const plans: RegionPlan[] = [];
  for (const reached of byPopulation(reach.regions, geography)) {
    const before = promotion.regionalPop[reached.regionId] ?? 0;
    const expectation = regionExpectation(
      {
        regionName: reached.regionName,
        popularity: before,
        prestige: promotion.prestige,
        importance: instance.importance,
        hype: null,
      },
      { tunables },
    );
    const change = showPopularityChange(
      {
        regionName: reached.regionName,
        score,
        expectation,
        before,
        weight: reached.weight,
        reachLabel: reached.label,
        importance: instance.importance,
        gainedThisMonth: gains[reached.regionId] ?? 0,
      },
      { tunables },
    );
    plans.push({ reached, before, expectation, change, capped: cappedByMonth(change) });
  }

  const regionDeltas: Partial<Record<RegionId, number>> = {};
  for (const plan of plans) {
    if (plan.change.value !== 0) {
      regionDeltas[plan.reached.regionId] = plan.change.value;
    }
  }
  const door =
    Object.keys(regionDeltas).length === 0
      ? null
      : applyPopularityChange(ctx, {
          subject: { kind: 'promotion', id: promotion.id },
          regionDeltas,
          source: 'system',
          reason: { key: SHOW_RESULT_REASON_KEY, label: instance.name },
        });

  const humanShow = promotion.controller.kind === 'human';
  const nextGains: Record<RegionId, number> = { ...gains };
  const regions: Record<RegionId, PopularityShowRegion> = {};
  let regionsGained = 0;
  let regionsLost = 0;
  let regionsCapped = 0;
  for (const plan of plans) {
    const { regionId } = plan.reached;
    const after = door?.byRegion[regionId]?.after ?? plan.before;
    if (after > plan.before) {
      regionsGained += 1;
      const total = roundHundredths((nextGains[regionId] ?? 0) + (after - plan.before));
      nextGains[regionId] = Math.min(GAINS_MAX, total);
    } else if (after < plan.before) {
      regionsLost += 1;
    }
    if (plan.capped) {
      regionsCapped += 1;
    }
    regions[regionId] = {
      source: plan.reached.source,
      networkId: plan.reached.networkId,
      weight: plan.reached.weight.value,
      expectation: plan.expectation.value,
      before: plan.before,
      after,
      capped: plan.capped,
    };
    ctx.recordTrace(showChangeTraceRef(instance.id, regionId, humanShow), ctx.date, plan.change);
  }

  ctx.tx.update('promotions', promotion.id, {
    popularityGains: { month: yearMonthOf(instance.date), byRegion: nextGains },
  });
  const worldBefore =
    door?.worldBefore ?? createPopularityRoller(geography).rollValues(promotion.regionalPop).world;
  const worldAfter = door?.worldAfter ?? worldBefore;
  ctx.tx.create('popularityShowChanges', {
    eventInstanceId: instance.id,
    promotionId: promotion.id,
    date: instance.date,
    score,
    worldBefore,
    worldAfter,
    regions,
  });
  ctx.publish('showPopularity.changed', {
    eventInstanceId: instance.id,
    promotionId: promotion.id,
    worldBefore,
    worldAfter,
    regionsGained,
    regionsLost,
    regionsCapped,
  });
  return { applied: true };
}
