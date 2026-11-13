/**
 * What a show would cost before it is booked: the show-cost formula run on a made-up card of
 * `headcount` workers, each on the promotion's average per-appearance fee. For planners that price
 * a show that does not exist yet (EVT8's tour builder, AIP7's calendar fit) and for the policy
 * preview.
 *
 * Design: docs/design/finances.md#show-costs.
 */

import type { PromotionId, RegionId } from '../../core/ids';
import { cents, type Cents } from '../../core/money';
import type { EventImportance } from '../../model/entities/event-definition';
import { promotionStatusKey } from '../../model/entities/employment';
import type { GameWorldView } from '../../model/tables';
import { EVENT_IMPORTANCE_LABELS } from '../match/formulas/crowdExpectation';
import type { EngineTunables } from '../tunables';
import { showCosts, type ShowCosts, type ShowCostWorker } from './formulas/showCosts';
import type { PolicyLevel } from './policies';
import { showDistanceOf } from './postShowCosts';

/** The show to price. */
export interface ShowEstimate {
  importance: EventImportance;
  /** Where the show is held. */
  regionId: RegionId;
  /** How many paid workers the show is expected to have. */
  headcount: number;
}

/** Policy levels to price the show at, instead of the promotion's own. */
export interface ShowEstimateLevels {
  travelLevel?: PolicyLevel;
  cateringLevel?: PolicyLevel;
}

/** The average per-appearance fee over the promotion's active contracts, to the cent (0 if none). */
export function averageAppearanceFee(read: GameWorldView, promotionId: PromotionId): Cents {
  const contracts = read.tables.employments.lookup(
    'byPromotionStatus',
    promotionStatusKey(promotionId, 'active'),
  );
  if (contracts.length === 0) {
    return cents(0);
  }
  const total = contracts.reduce((sum, contract) => sum + contract.terms.perAppearanceFee, 0);
  return cents(Math.round(total / contracts.length));
}

/** `headcount` stand-in workers, each on `fee`. */
function syntheticWorkers(headcount: number, fee: Cents): ShowCostWorker[] {
  const count = Math.max(0, Math.floor(headcount));
  return Array.from({ length: count }, (_, index): ShowCostWorker => ({
    name: `Worker ${String(index + 1)} (average contract)`,
    perAppearanceFee: fee,
    travelCovered: false,
    excluded: null,
  }));
}

/**
 * The estimated appearance fees, travel and catering of a show `promotionId` might run, with the
 * same formula a completed show is charged by. `levels` prices it at other policy levels (the
 * policy preview); by default the promotion's own.
 */
export function estimateShowCosts(
  read: GameWorldView,
  promotionId: PromotionId,
  show: ShowEstimate,
  tunables: EngineTunables,
  levels: ShowEstimateLevels = {},
): ShowCosts {
  const promotion = read.tables.promotions.require(promotionId);
  return showCosts(
    {
      workers: syntheticWorkers(show.headcount, averageAppearanceFee(read, promotionId)),
      estimated: true,
      importance: show.importance,
      importanceLabel: EVENT_IMPORTANCE_LABELS[show.importance],
      distance: showDistanceOf(read, promotion, show.regionId),
      travelLevel: levels.travelLevel ?? promotion.policies.travel,
      cateringLevel: levels.cateringLevel ?? promotion.policies.catering,
    },
    { tunables },
  );
}
