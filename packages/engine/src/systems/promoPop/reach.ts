/**
 * Reach inputs from the world: which TV deals carry a show, and the plain inputs `showReach` takes
 * for it (EVT5-02).
 *
 * Which deals carry a show is ECO8's answer (`dealsAiringShow`, ECO8-07), so reach and the TV
 * money always agree: the promotion's deals in force on the show's air date that cover it (bound
 * to its definition, or promotion-wide for a televised show the network kind airs: a pay-per-view
 * deal only major and flagship shows, and a promotion-wide deal steps aside for a deal bound to
 * the show on the same kind of network). Once a deal's airing of the show is settled, that row
 * decides: a missed airing reaches nobody, and an aired one names its viewers in the reach line
 * ("TV: National Signal Network, 2.4M viewers").
 *
 * A taped show (EVT9) takes place on `date` and airs on `airDate`: the show region is where it was
 * taped, and the deals are the ones in force on the air date.
 *
 * Exported for ECO8 (TV deals) and EVT6 (attendance), which need the same answer.
 * Design: docs/design/promotion-popularity.md#show-reach.
 */

import type { NetworkId } from '../../core/ids';
import type { Airing } from '../../model/entities/airing';
import type { Deal } from '../../model/entities/deal';
import type { EventInstance } from '../../model/entities/event-instance';
import { coveredRegionIds, type Network } from '../../model/entities/network';
import { compareIds } from '../../model/table';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';
import { dealsAiringShow } from '../broadcast/coverage';
import type { Geography } from '../world/geography';
import type { ReachAudience } from './formulas/labels';
import type { ReachDealInput, ReachRegionInput, ShowReachInputs } from './formulas/showReach';

/** The show reach reads: a dated show. */
export type ReachShow = EventInstance;

/** The show's settled airings on its air date, by deal. */
function airingsByDeal(read: GameWorldView, show: ReachShow): Map<Deal['id'], Airing> {
  const byDeal = new Map<Deal['id'], Airing>();
  for (const airing of read.tables.airings.lookup('byEventInstance', show.id)) {
    if (airing.airDate === show.airDate) {
      byDeal.set(airing.dealId, airing);
    }
  }
  return byDeal;
}

/**
 * The deals that carry `show` to an audience, in deal id order: ECO8's deals airing it on its air
 * date, less any whose airing of it was missed.
 */
export function dealsInForce(read: GameWorldView, show: ReachShow): DeepReadonly<Deal>[] {
  const settled = airingsByDeal(read, show);
  return dealsAiringShow(read, show)
    .filter((deal) => settled.get(deal.id)?.status !== 'missed')
    .sort((left, right) => compareIds(left.id, right.id));
}

/** What an aired airing drew, or null while it has not aired. */
function audienceOf(
  airing: Airing | undefined,
  network: DeepReadonly<Network>,
): ReachAudience | null {
  if (airing?.status !== 'aired') {
    return null;
  }
  return { count: airing.viewers, noun: network.kind === 'ppv' ? 'buys' : 'viewers' };
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
  const settled = airingsByDeal(read, show);
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
      audience: audienceOf(settled.get(deal.id), network),
    });
  }
  return { showRegion: { id: showRegion.id, name: showRegion.name }, neighbours, deals };
}
