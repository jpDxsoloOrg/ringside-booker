/**
 * Reach inputs from the world: which TV deals carry a show, and the plain inputs `showReach` takes
 * for it (EVT5-02).
 *
 * A deal carries a show when it is the promotion's, is active, has started by the day the show airs
 * and has not yet ended, its network is still on air, and it is either bound to the show's own
 * definition or is promotion-wide and the show's definition is televised. A one-off show with no
 * definition is carried only by deals bound to it, and deals are bound to definitions, so none.
 * A taped show (EVT9) takes place on `date` and airs on `airDate`: the show region is where it was
 * taped, and the deals are the ones in force on the air date.
 *
 * Exported for ECO8 (TV deals) and EVT6 (attendance), which need the same answer.
 * Design: docs/design/promotion-popularity.md#show-reach.
 */

import { compareDates } from '../../core/date';
import type { NetworkId } from '../../core/ids';
import type { Deal } from '../../model/entities/deal';
import type { EventInstance } from '../../model/entities/event-instance';
import { coveredRegionIds, type Network } from '../../model/entities/network';
import { compareIds } from '../../model/table';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';
import type { Geography } from '../world/geography';
import type { ReachDealInput, ReachRegionInput, ShowReachInputs } from './formulas/showReach';

/** The show fields reach reads. */
export type ReachShow = Pick<
  DeepReadonly<EventInstance>,
  'promotionId' | 'eventDefinitionId' | 'regionId' | 'airDate'
>;

/** True when `deal` is in force on `airDate`: active, started, and not yet ended. */
function inForceOn(deal: DeepReadonly<Deal>, airDate: ReachShow['airDate']): boolean {
  return (
    deal.status === 'active' &&
    compareDates(deal.startsOn, airDate) <= 0 &&
    compareDates(airDate, deal.endsOn) < 0
  );
}

/** True when `deal` carries the show: bound to its definition, or promotion-wide and televised. */
function carriesShow(read: GameWorldView, deal: DeepReadonly<Deal>, show: ReachShow): boolean {
  if (show.eventDefinitionId === null) {
    return false;
  }
  if (deal.eventDefinitionId !== null) {
    return deal.eventDefinitionId === show.eventDefinitionId;
  }
  return read.tables.eventDefinitions.get(show.eventDefinitionId)?.televised === true;
}

/**
 * The TV deals in force that carry `show`, in deal id order: the promotion's active deals running
 * on the air date, on a network still on air, for the show's definition or (promotion-wide) for a
 * televised definition.
 */
export function dealsInForce(read: GameWorldView, show: ReachShow): DeepReadonly<Deal>[] {
  return read.tables.deals
    .lookup('byPromotion', show.promotionId)
    .filter(
      (deal) =>
        inForceOn(deal, show.airDate) &&
        read.tables.networks.get(deal.networkId)?.status === 'active' &&
        carriesShow(read, deal, show),
    )
    .sort((left, right) => compareIds(left.id, right.id));
}

/** A network's reach tier as the reach formula types it (the schema keeps it within 0..4). */
function reachTierOf(network: DeepReadonly<Network>): ReachDealInput['reachTier'] {
  const tier = network.reachTier;
  if (tier === 0 || tier === 1 || tier === 2 || tier === 3 || tier === 4) {
    return tier;
  }
  return tier < 0 ? 0 : 4;
}

function regionInput(geography: Geography, regionId: ReachShow['regionId']): ReachRegionInput {
  return { id: regionId, name: geography.region(regionId).name };
}

/**
 * The inputs `showReach` takes for `show`: its region, that region's neighbours, and each deal in
 * force with its network's name, reach tier and covered regions.
 */
export function reachInputsFor(
  read: GameWorldView,
  show: ReachShow,
  geography: Geography,
): ShowReachInputs {
  const showRegion = geography.region(show.regionId);
  const neighbours = showRegion.neighbourRegionIds
    .filter((regionId) => read.tables.regions.has(regionId))
    .map((regionId) => regionInput(geography, regionId));
  const deals: ReachDealInput[] = [];
  for (const deal of dealsInForce(read, show)) {
    const network = read.tables.networks.get(deal.networkId);
    if (network === undefined) {
      continue;
    }
    const networkId: NetworkId = network.id;
    deals.push({
      dealId: deal.id,
      networkId,
      networkName: network.name,
      reachTier: reachTierOf(network),
      regions: coveredRegionIds(network, read).map((regionId) => regionInput(geography, regionId)),
    });
  }
  return { showRegion: { id: showRegion.id, name: showRegion.name }, neighbours, deals };
}
