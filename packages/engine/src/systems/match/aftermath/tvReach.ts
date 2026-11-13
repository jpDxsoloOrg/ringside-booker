/**
 * TV reach for worker popularity (MTCH3-05): the popularity reach provider that lets a televised
 * match move its competitors' popularity in the regions the show's TV deals cover, the same way
 * EVT5 spreads the promotion's popularity.
 *
 * - On show night the regions come from EVT5's `reachInputsFor` → `showReach` for the show (the
 *   deals in force on its air date), keeping only the regions reached by TV. Each gets EVT5's TV
 *   weight for the network's reach tier × `match.popularity.tvSpill`, with the reason
 *   "TV reach: <network>".
 * - In the Match lab (no show) with Televised on, the promotion's deals in force on the lab's date
 *   stand in for the show's: every active deal on a network still on air.
 * - A lab match with Televised off, a show no deal carries, or a spill of 0 reaches nothing.
 *
 * The show region and its neighbours are MTCH3's own (`segmentRegionWeights`), so they are left
 * out here. Registered at module load with the match bundle.
 *
 * Design: docs/design/match-aftermath.md#integrations and promotion-popularity.md#show-reach.
 */

import { compareDates } from '../../../core/date';
import type { GameDate } from '../../../core/date';
import type { PromotionId } from '../../../core/ids';
import { coveredRegionIds } from '../../../model/entities/network';
import { compareIds } from '../../../model/table';
import type { GameWorldView } from '../../../model/tables';
import { reachInputsFor } from '../../promoPop/reach';
import {
  showReach,
  type ReachDealInput,
  type ShowReachInputs,
} from '../../promoPop/formulas/showReach';
import type { EngineTunables } from '../../tunables';
import { geographyOf } from '../../world/geography';
import { registerPopularityReach, type ReachContext, type ReachRegion } from './reach';

export const TV_REACH_PROVIDER_ID = 'match.tvReach';

/** Runs before any other provider a later feature adds. */
export const TV_REACH_PROVIDER_ORDER = 10;

/** "TV reach: Coastline Sports". */
export function tvReachReason(networkName: string): string {
  return `TV reach: ${networkName}`;
}

/** The highest reach tier the reach formula knows. */
const TOP_REACH_TIER = 4;

function reachTierOf(tier: number): ReachDealInput['reachTier'] {
  if (tier === 0 || tier === 1 || tier === 2 || tier === 3 || tier === 4) {
    return tier;
  }
  return tier < 0 ? 0 : TOP_REACH_TIER;
}

/**
 * The deals a Match lab match on no show is carried by: the promotion's active deals running on
 * `date`, on a network still on air, in deal id order.
 */
function labDeals(read: GameWorldView, promotionId: PromotionId, date: GameDate): ReachDealInput[] {
  const geography = geographyOf(read);
  const deals: ReachDealInput[] = [];
  const inForce = read.tables.deals
    .lookup('byPromotion', promotionId)
    .filter(
      (deal) =>
        deal.status === 'active' &&
        compareDates(deal.startsOn, date) <= 0 &&
        compareDates(date, deal.endsOn) < 0,
    )
    .sort((left, right) => compareIds(left.id, right.id));
  for (const deal of inForce) {
    const network = read.tables.networks.get(deal.networkId);
    if (network?.status !== 'active') {
      continue;
    }
    deals.push({
      dealId: deal.id,
      networkId: network.id,
      networkName: network.name,
      reachTier: reachTierOf(network.reachTier),
      regions: coveredRegionIds(network, read).map((regionId) => ({
        id: regionId,
        name: geography.region(regionId).name,
      })),
    });
  }
  return deals;
}

/** EVT5's reach inputs for the match, with no neighbours: MTCH3 weighs those itself. */
function inputsFor(read: GameWorldView, ctx: ReachContext): ShowReachInputs | null {
  const geography = geographyOf(read);
  if (ctx.eventInstanceId !== null) {
    const show = read.tables.eventInstances.get(ctx.eventInstanceId);
    if (show === undefined) {
      return null;
    }
    return { ...reachInputsFor(read, show, geography), neighbours: [] };
  }
  if (!ctx.televised) {
    return null;
  }
  const region = geography.region(ctx.regionId);
  return {
    showRegion: { id: region.id, name: region.name },
    neighbours: [],
    deals: labDeals(read, ctx.promotionId, ctx.date),
  };
}

/** The TV regions a match reaches, at EVT5's TV weight × `match.popularity.tvSpill`. */
export function tvReachRegions(
  read: GameWorldView,
  ctx: ReachContext,
  tunables: EngineTunables,
): readonly ReachRegion[] {
  const spill = tunables.get('match.popularity.tvSpill');
  if (spill <= 0) {
    return [];
  }
  const inputs = inputsFor(read, ctx);
  if (inputs === null || inputs.deals.length === 0) {
    return [];
  }
  const networkNames = new Map(inputs.deals.map((deal) => [deal.networkId, deal.networkName]));
  const regions: ReachRegion[] = [];
  for (const reached of showReach(inputs, { tunables }).regions) {
    if (reached.source !== 'tv' || reached.networkId === null) {
      continue;
    }
    regions.push({
      regionId: reached.regionId,
      weight: reached.weight.value * spill,
      reason: tvReachReason(networkNames.get(reached.networkId) ?? reached.label),
    });
  }
  return regions;
}

registerPopularityReach({
  id: TV_REACH_PROVIDER_ID,
  order: TV_REACH_PROVIDER_ORDER,
  regionsFor: tvReachRegions,
});
