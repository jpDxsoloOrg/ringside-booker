/**
 * Posting a completed show's costs (ECO1-04): appearance fees, travel and catering, one ledger row
 * each, every row linked to the show (`refs.eventInstanceId`) with a Why? listing the workers and
 * rates. Runs for every promotion's shows, player and rival alike, from the `show.completed`
 * reaction `finance.postShowCosts`.
 *
 * Design: docs/design/finances.md#show-costs.
 */

import { yearMonthOf, type GameDate } from '../../core/date';
import { EntityNotFoundError, InvalidArgumentError } from '../../core/errors';
import type { EventInstanceId, PromotionId, RegionId } from '../../core/ids';
import type { StepContext } from '../../core/pipeline/context';
import type { EventInstance } from '../../model/entities/event-instance';
import { ledgerMonthKey, type LedgerCategory } from '../../model/entities/ledger-entry';
import type { Promotion } from '../../model/entities/promotion';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';
import { EVENT_IMPORTANCE_LABELS } from '../match/formulas/crowdExpectation';
import type { EngineTunables } from '../tunables';
import { showCosts, type ShowCosts, type ShowDistance } from './formulas/showCosts';
import { postCost } from './phases';
import { showWorkersOf } from './showWorkers';

/** The subscription id of the reaction that posts a completed show's costs. */
export const POST_SHOW_COSTS_SUBSCRIPTION_ID = 'finance.postShowCosts';

/** The ledger categories a show's costs are posted under, in the order they are posted. */
export const SHOW_COST_CATEGORIES = ['appearanceFees', 'travel', 'catering'] as const;
export type ShowCostCategory = (typeof SHOW_COST_CATEGORIES)[number];

const SHOW_COST_MEMOS: Readonly<Record<ShowCostCategory, string>> = Object.freeze({
  appearanceFees: 'appearance fees',
  travel: 'travel',
  catering: 'catering',
});

function isShowCostCategory(category: LedgerCategory): boolean {
  return SHOW_COST_CATEGORIES.some((candidate) => candidate === category);
}

/**
 * Where `regionId` is, seen from the promotion's home: its home region, elsewhere in its home
 * country, or another country. An unknown region counts as another country.
 */
export function showDistanceOf(
  read: GameWorldView,
  promotion: Pick<Promotion, 'homeRegionId'>,
  regionId: RegionId,
): ShowDistance {
  if (regionId === promotion.homeRegionId) {
    return 'home';
  }
  const home = read.tables.regions.get(promotion.homeRegionId);
  const there = read.tables.regions.get(regionId);
  return home !== undefined && there?.countryId === home.countryId ? 'domestic' : 'abroad';
}

/** The three costs of `instance` as its promotion's policies price them today. Pure. */
export function showCostsOf(
  read: GameWorldView,
  instance: DeepReadonly<EventInstance>,
  tunables: EngineTunables,
): ShowCosts {
  const promotion = read.tables.promotions.require(instance.promotionId);
  const { workers, estimated } = showWorkersOf(read, instance, tunables);
  return showCosts(
    {
      workers,
      estimated,
      importance: instance.importance,
      importanceLabel: EVENT_IMPORTANCE_LABELS[instance.importance],
      distance: showDistanceOf(read, promotion, instance.regionId),
      travelLevel: promotion.policies.travel,
      cateringLevel: promotion.policies.catering,
    },
    { tunables },
  );
}

/** True when a show-cost row for the show is already on the promotion's books. */
function alreadyPosted(
  read: GameWorldView,
  promotionId: PromotionId,
  eventInstanceId: EventInstanceId,
  dates: readonly GameDate[],
): boolean {
  const months = [...new Set(dates.map(yearMonthOf))];
  return months.some((month) =>
    read.tables.ledgerEntries
      .lookup('byPromotionMonth', ledgerMonthKey(promotionId, month))
      .some(
        (row) => row.refs.eventInstanceId === eventInstanceId && isShowCostCategory(row.category),
      ),
  );
}

/**
 * Posts the costs of the completed show `eventInstanceId`: one row per non-zero cost, memo
 * "<show name>: appearance fees" (travel, catering), each with the show in `refs.eventInstanceId`.
 * Idempotent: does nothing when a show-cost row for the show is already posted. Does nothing for a
 * closed promotion (it has no books to post to).
 *
 * Throws `EntityNotFoundError` for an unknown show and `InvalidArgumentError` for one that is not
 * completed.
 */
export function postShowCosts(ctx: StepContext, eventInstanceId: EventInstanceId): void {
  const instance = ctx.read.tables.eventInstances.get(eventInstanceId);
  if (instance === undefined) {
    throw new EntityNotFoundError('eventInstance', eventInstanceId);
  }
  if (instance.status !== 'completed') {
    throw new InvalidArgumentError(
      'postShowCosts',
      'eventInstanceId',
      eventInstanceId,
      'a completed show',
    );
  }
  const promotion = ctx.read.tables.promotions.require(instance.promotionId);
  if (promotion.status === 'closed') {
    ctx.log(`${instance.name}: ${promotion.name} is closed, no show costs posted`);
    return;
  }
  if (alreadyPosted(ctx.read, promotion.id, instance.id, [instance.date, ctx.date])) {
    ctx.log(`${instance.name}: show costs already posted`);
    return;
  }
  const costs = showCostsOf(ctx.read, instance, ctx.tunables);
  for (const category of SHOW_COST_CATEGORIES) {
    postCost(
      ctx,
      promotion.id,
      category,
      `${instance.name}: ${SHOW_COST_MEMOS[category]}`,
      costs[category],
      { eventInstanceId: instance.id },
    );
  }
}
