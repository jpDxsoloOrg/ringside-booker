/**
 * What a promotion needs to keep to run its shows (DRF-11): its running costs a month, priced
 * ahead at the draft, and the reserve rivals hold back while they draft.
 *
 * Running costs a month =
 *
 * - **overhead**: the production, marketing and back office overhead at its levels
 *   (`productionMonthlyCost`; nothing at level 0);
 * - **medical**: its medical policy for a full roster (the draft's wrestler and staff targets);
 * - **shows**: its shows in the next {@link RESERVE_WINDOW_DAYS} days, turned into a month: each
 *   one's venue rent (its venue, else where the box office's automatic pick would hold it), travel and catering at its policies for the card's headcount
 *   (`estimateShowCosts`, appearance fees left out: draft picks are prepaid) and per-show
 *   production (`upcomingShowCost`).
 *
 * Income is left out on purpose: a reserve is what the cash must cover if the shows draw nobody.
 * The reserve is `draft.ai.reserveMonths` (3) months of it. Rivals keep it while drafting; the
 * player is only held to never going below zero, and the draft room warns them when a pick leaves
 * less than this.
 *
 * Design: docs/design/draft.md#rival-reserve.
 */

import type { GameDate } from '../../core/date';
import type { PromotionId } from '../../core/ids';
import type { EventInstance } from '../../model/entities/event-instance';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';
import { computeVenueRent } from '../boxOffice/formulas/venueRent';
import { pickVenueFor } from '../boxOffice/pickVenueFor';
import { showVenueOf } from '../boxOffice/showVenue';
import { choiceOfKey, showVenueForChoice } from '../boxOffice/venueChoice';
import { estimateShowCosts } from '../finance/estimateShowCosts';
import { MEDICAL_LEVEL_LABELS, monthlyMedical } from '../finance/formulas/monthlyMedical';
import { productionMonthlyCost } from '../production/formulas/productionMonthlyCost';
import { upcomingShowCost } from '../production/formulas/productionShowCost';
import { upcomingShows } from '../production/upcoming';
import type { EngineTunables } from '../tunables';

/** Days of shows priced ahead, then turned into a month: eight weeks, so a weekly show counts 8. */
export const RESERVE_WINDOW_DAYS = 56;

const DAYS_PER_MONTH = 365 / 12;

/** A promotion's running costs a month, in whole cents, by part. */
export interface RunningCosts {
  readonly overhead: number;
  readonly medical: number;
  readonly venueRent: number;
  readonly travel: number;
  readonly catering: number;
  readonly showProduction: number;
  /** Shows a month the show parts were priced for. */
  readonly showsPerMonth: number;
  readonly total: number;
}

function venueRentOf(
  read: GameWorldView,
  tunables: EngineTunables,
  promotionId: PromotionId,
  instance: DeepReadonly<EventInstance>,
): number {
  // Its venue, or where the box office's automatic pick would hold it.
  const venue =
    showVenueOf(read, instance) ??
    showVenueForChoice(
      read,
      tunables,
      instance,
      choiceOfKey(pickVenueFor(read, tunables, instance).value),
    );
  if (venue === null) {
    return 0;
  }
  return computeVenueRent(
    {
      capacity: venue.capacity,
      venueKind: venue.venueKind,
      venueName: venue.name,
      ownVenue: venue.kind === 'venue' && venue.exclusivePromotionId === promotionId,
    },
    { tunables },
  ).value;
}

/** The promotion's running costs a month from `date`, with a roster of `headcount` people. */
export function runningCostsOf(
  read: GameWorldView,
  tunables: EngineTunables,
  promotionId: PromotionId,
  date: GameDate,
  headcount: number,
): RunningCosts {
  const promotion = read.tables.promotions.require(promotionId);
  const overhead = productionMonthlyCost(
    { promotionName: promotion.name, levels: promotion.production },
    { tunables },
  ).total.value;
  const medicalLevel = promotion.policies.medical;
  const medical = monthlyMedical(
    {
      contracts: headcount,
      level: medicalLevel,
      levelLabel: MEDICAL_LEVEL_LABELS[medicalLevel],
    },
    { tunables },
  ).value;
  const shows = upcomingShows(read, promotionId, date, RESERVE_WINDOW_DAYS);
  const showProduction = upcomingShowCost(
    { promotionName: promotion.name, shows, levels: promotion.production },
    { tunables },
  ).value;
  const perSlot = tunables.get('finance.show.offscreenWorkersPerSlot');
  let venueRent = 0;
  let travel = 0;
  let catering = 0;
  for (const show of shows) {
    const instance =
      show.eventInstanceId === null
        ? undefined
        : read.tables.eventInstances.get(show.eventInstanceId);
    if (instance === undefined) {
      continue;
    }
    venueRent += venueRentOf(read, tunables, promotionId, instance);
    const costs = estimateShowCosts(
      read,
      promotionId,
      {
        importance: instance.importance,
        regionId: instance.regionId,
        headcount: instance.format.slots * perSlot,
      },
      tunables,
    );
    travel += costs.travel.value;
    catering += costs.catering.value;
  }
  const toMonth = (amount: number): number =>
    Math.round((amount * DAYS_PER_MONTH) / RESERVE_WINDOW_DAYS);
  const parts = {
    overhead,
    medical,
    venueRent: toMonth(venueRent),
    travel: toMonth(travel),
    catering: toMonth(catering),
    showProduction: toMonth(showProduction),
  };
  return {
    ...parts,
    showsPerMonth: Math.round((shows.length * DAYS_PER_MONTH * 10) / RESERVE_WINDOW_DAYS) / 10,
    total:
      parts.overhead +
      parts.medical +
      parts.venueRent +
      parts.travel +
      parts.catering +
      parts.showProduction,
  };
}

/** The cash a rival keeps while drafting: `draft.ai.reserveMonths` months of running costs. */
export function draftReserve(
  read: GameWorldView,
  tunables: EngineTunables,
  promotionId: PromotionId,
  date: GameDate,
  headcount: number,
): number {
  const months = tunables.get('draft.ai.reserveMonths');
  if (months <= 0) {
    return 0;
  }
  return Math.round(months * runningCostsOf(read, tunables, promotionId, date, headcount).total);
}
