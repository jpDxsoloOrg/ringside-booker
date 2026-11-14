/**
 * The payoff planner (CRTV4-03): what ending a storyline pays each member, worked out without
 * writing anything. The `storylines.payoff` preview and the real payoff (`storylines.payOffOnEnd`)
 * both call it, so what the player is shown is exactly what is applied.
 *
 * Design: docs/design/storylines.md#payoff.
 */

import type { EmploymentId, PersonId, PromotionId, RegionId, StorylineId } from '../../../core/ids';
import { startCalc } from '../../../core/trace/calc';
import type { Traced } from '../../../core/trace/types';
import { compareIds } from '../../../model/table';
import type { GameWorldView } from '../../../model/tables';
import type { EngineTunables } from '../../tunables';
import { footprintPopularityAt } from '../../workers/helpers/expectedPushAt';
import { memberPayoff } from '../formulas/memberPayoff';
import { payoffEligible, payoffQuality, type PayoffOutcome } from '../formulas/payoffQuality';
import { activeEmploymentAt } from '../rows';
import { segmentWasPlayed } from './links';

export const LEFT_PROMOTION_PAYOFF_TEXT = 'Left the promotion: no payoff';
export const NO_FAN_BASE_PAYOFF_TEXT = 'The promotion has no fan base big enough to notice';

/** One member's share of the payoff. */
export interface PayoffPlanMember {
  readonly personId: PersonId;
  /** Ring name at the promotion, or the person's default ring name once they have left. */
  readonly name: string;
  /** The member's active employment at the promotion, or null when they have left. */
  readonly employmentId: EmploymentId | null;
  /** The member's popularity among the promotion's fans; null when skipped. */
  readonly marketPopularity: number | null;
  /** Popularity asked of WRK1's door, spread over `regionWeights`. 0 when skipped. */
  readonly popularity: Traced<number>;
  /** Momentum asked of WRK1's door. 0 when skipped. */
  readonly momentum: Traced<number>;
  /** Why this member gets nothing, or null when they are paid. */
  readonly skippedReason: string | null;
}

/** What ending a storyline today pays (or paid), member by member. Plain JSON. */
export interface PayoffPlan {
  readonly storylineId: StorylineId;
  readonly promotionId: PromotionId;
  readonly storylineName: string;
  /** Heat when it ends. */
  readonly heat: number;
  /** Linked segments that counted, all time (`progressTotals.segments`). */
  readonly countedSegments: number;
  readonly minSegments: number;
  readonly finalePlayed: boolean;
  /** True when it has enough counted segments to pay off at all. */
  readonly eligible: boolean;
  /** The same as a traced decision, so a screen can word the outcome. */
  readonly outcome: Traced<PayoffOutcome>;
  readonly quality: Traced<number>;
  /** Members in the storyline's order. */
  readonly members: readonly PayoffPlanMember[];
  /**
   * The promotion's regions with popularity of at least `storylines.payoff.minRegionPop`, weighted
   * by that popularity ÷ 100, in region-id order.
   */
  readonly regionWeights: Readonly<Record<RegionId, number>>;
}

function nothing(label: string, reason: string): Traced<number> {
  return startCalc(label, 0, { unit: 'points', startLabel: reason }).done();
}

/** The promotion's fan-base regions a payoff reaches, weighted by its popularity there. */
export function payoffRegionWeights(
  read: GameWorldView,
  tunables: EngineTunables,
  promotionId: PromotionId,
): Record<RegionId, number> {
  const minRegionPop = tunables.get('storylines.payoff.minRegionPop');
  const promotion = read.tables.promotions.require(promotionId);
  const regionIds = read.tables.regions
    .values()
    .map((region) => region.id)
    .sort(compareIds);
  const weights: Record<RegionId, number> = {};
  for (const regionId of regionIds) {
    const pop = promotion.regionalPop[regionId];
    if (pop !== undefined && pop > 0 && pop >= minRegionPop) {
      weights[regionId] = pop / 100;
    }
  }
  return weights;
}

/**
 * What ending `storylineId` pays each member: the storyline's heat now, its all-time counted
 * segments and whether its finale was played. Members who no longer work for the promotion are
 * skipped, and so is everyone when the promotion has no region at `storylines.payoff.minRegionPop`.
 * Throws `EntityNotFoundError` for an unknown storyline.
 */
export function planPayoff(
  read: GameWorldView,
  tunables: EngineTunables,
  storylineId: StorylineId,
): PayoffPlan {
  const storyline = read.tables.storylines.require(storylineId);
  const countedSegments = storyline.progressTotals.segments;
  const finalePlayed =
    storyline.finaleSegmentId !== null && segmentWasPlayed(read, storyline.finaleSegmentId);
  const outcome = payoffEligible({ countedSegments, storylineName: storyline.name }, { tunables });
  const quality = payoffQuality(
    { heat: storyline.heat, countedSegments, finalePlayed, storylineName: storyline.name },
    { tunables },
  );
  const regionWeights = payoffRegionWeights(read, tunables, storyline.promotionId);
  const hasFanBase = Object.keys(regionWeights).length > 0;

  const members = storyline.members.map((member): PayoffPlanMember => {
    const person = read.tables.people.require(member.personId);
    const employment = activeEmploymentAt(read, person.id, storyline.promotionId);
    const name = employment?.ringName ?? person.defaultRingName;
    const skippedReason =
      employment === null
        ? LEFT_PROMOTION_PAYOFF_TEXT
        : hasFanBase
          ? null
          : NO_FAN_BASE_PAYOFF_TEXT;
    if (skippedReason !== null) {
      return {
        personId: person.id,
        name,
        employmentId: employment?.id ?? null,
        marketPopularity: null,
        popularity: nothing(`Popularity payoff for ${name}`, skippedReason),
        momentum: nothing(`Momentum payoff for ${name}`, skippedReason),
        skippedReason,
      };
    }
    const marketPopularity = footprintPopularityAt(
      read,
      person.id,
      storyline.promotionId,
      tunables,
    ).value;
    const payoff = memberPayoff(
      { quality, heat: storyline.heat, memberMarketPop: marketPopularity, memberName: name },
      { tunables },
    );
    return {
      personId: person.id,
      name,
      employmentId: employment?.id ?? null,
      marketPopularity,
      popularity: payoff.popularity,
      momentum: payoff.momentum,
      skippedReason: null,
    };
  });

  return {
    storylineId: storyline.id,
    promotionId: storyline.promotionId,
    storylineName: storyline.name,
    heat: storyline.heat,
    countedSegments,
    minSegments: tunables.get('storylines.payoff.minSegments'),
    finalePlayed,
    eligible: outcome.value === 'pay',
    outcome,
    quality,
    members,
    regionWeights,
  };
}
