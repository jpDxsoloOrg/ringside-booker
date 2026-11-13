/**
 * Show reach: which regions saw a show, and how much of it each one saw.
 *
 * A show reaches its own region in full, the neighbouring regions at a reduced weight and, when it
 * is televised, every region a deal in force covers at a weight set by the network's reach tier.
 * A region reached several ways takes the largest weight, never the sum, and never more than 1.
 * Each region's weight is its own trace: every route that reached it is a line, the strongest one
 * counts, and EVT5-02 nests the trace inside that region's popularity change.
 *
 * Design: docs/design/promotion-popularity.md#show-reach.
 */

import { InvalidArgumentError } from '../../../core/errors';
import type { DealId, NetworkId, RegionId } from '../../../core/ids';
import { constantOf, startCalc, type Traced } from '../../../core/trace';
import type { EngineTunables, NumberTunableKey } from '../../tunables';
import { formatNumber } from '../../world/people/labels';
import { reachLabel, type ReachRoute, type ReachSource } from './labels';

export const SHOW_REACH_DOC_REF = 'promotion-popularity.md#show-reach';

/** A region as the reach formula needs it: its id and the name the trace shows. */
export interface ReachRegionInput {
  readonly id: RegionId;
  readonly name: string;
}

/** A TV deal in force for the show, with the regions it covers. */
export interface ReachDealInput {
  readonly dealId: DealId;
  readonly networkId: NetworkId;
  readonly networkName: string;
  readonly reachTier: 0 | 1 | 2 | 3 | 4;
  readonly regions: readonly ReachRegionInput[];
}

export interface ShowReachInputs {
  /** The region the show takes place in. */
  readonly showRegion: ReachRegionInput;
  /** The show region's neighbours (`regions.neighbourRegionIds`). */
  readonly neighbours: readonly ReachRegionInput[];
  /** The deals in force that carry the show. Empty for an untelevised show. */
  readonly deals: readonly ReachDealInput[];
}

/** One region the show reached. */
export interface ReachedRegion {
  readonly regionId: RegionId;
  readonly regionName: string;
  /** The route that gave the region its weight: the strongest one. */
  readonly source: ReachSource;
  /** The network of a `tv` route; null otherwise. */
  readonly networkId: NetworkId | null;
  /** The strongest route in words, as the "Seen here as" line reads it: "TV: <network>". */
  readonly label: string;
  /** How much of the show the region saw, 0 (exclusive) to 1. */
  readonly weight: Traced<number>;
}

export interface ShowReach {
  /** The show region first, then by weight (largest first), then by region id. */
  readonly regions: readonly ReachedRegion[];
}

const TV_REACH_KEYS = [
  'promoPop.tvReach.tier0',
  'promoPop.tvReach.tier1',
  'promoPop.tvReach.tier2',
  'promoPop.tvReach.tier3',
  'promoPop.tvReach.tier4',
] as const satisfies readonly NumberTunableKey[];

/** A route waiting to be weighed, with the tunable that sets its weight (none for the show region). */
interface PendingRoute {
  readonly route: ReachRoute;
  readonly key: NumberTunableKey | null;
  /** The short name of that tunable in the trace. */
  readonly tunableLabel: string;
  /** The text after the route's label: " × 0.5", ", reach tier 4 × 0.6". */
  readonly detail: (weight: number) => string;
}

interface RegionRoutes {
  readonly region: ReachRegionInput;
  readonly routes: PendingRoute[];
}

const NO_REACH_REASON = 'A region the show did not reach saw none of it';
const FULL_REACH_REASON = "A region can't see a show more than fully";
const SHOW_REGION_REASON = 'The region the show takes place in sees all of it';

function routeWeight(route: PendingRoute, tunables: EngineTunables): number {
  return route.key === null ? 1 : tunables.get(route.key);
}

function weighRegion(
  entry: RegionRoutes,
  tunables: EngineTunables,
): { readonly weight: Traced<number>; readonly strongest: PendingRoute } {
  const calc = startCalc(
    `Reach in ${entry.region.name}`,
    constantOf('Not reached', 0, NO_REACH_REASON),
    { unit: 'ratio', docRef: SHOW_REACH_DOC_REF },
  );
  let strongest: PendingRoute | null = null;
  let strongestWeight = -1;
  for (const pending of entry.routes) {
    const weight = routeWeight(pending, tunables);
    const label = `${reachLabel(pending.route)}${pending.detail(weight)}`;
    if (pending.key === null) {
      calc.max(label, constantOf('Show region', 1, SHOW_REGION_REASON));
    } else {
      calc.max(label, calc.tunable(tunables, pending.key, pending.tunableLabel));
    }
    // The first route wins a tie: the show region, then neighbours, then TV in deal order.
    if (weight > strongestWeight) {
      strongest = pending;
      strongestWeight = weight;
    }
  }
  if (strongest === null) {
    throw new InvalidArgumentError('showReach', 'routes', entry.region.id, 'at least one route');
  }
  if (entry.routes.length > 1) {
    calc.note('Reached several ways: the strongest counts');
  }
  calc.min('Full reach', constantOf('Full reach', 1, FULL_REACH_REASON));
  return { weight: calc.done(), strongest };
}

function compareReached(left: ReachedRegion, right: ReachedRegion): number {
  if (left.source === 'show' || right.source === 'show') {
    return left.source === 'show' ? -1 : 1;
  }
  if (left.weight.value !== right.weight.value) {
    return right.weight.value - left.weight.value;
  }
  return left.regionId < right.regionId ? -1 : left.regionId > right.regionId ? 1 : 0;
}

/**
 * The regions a show reached and each one's weight. Plain inputs only: the caller reads the show's
 * region, its neighbours and the deals in force. Regions whose weight comes to 0 are left out.
 */
export function showReach(
  inputs: ShowReachInputs,
  deps: { readonly tunables: EngineTunables },
): ShowReach {
  const { tunables } = deps;
  const byRegion = new Map<RegionId, RegionRoutes>();
  const routesOf = (region: ReachRegionInput): PendingRoute[] => {
    const existing = byRegion.get(region.id);
    if (existing !== undefined) {
      return existing.routes;
    }
    const created: RegionRoutes = { region, routes: [] };
    byRegion.set(region.id, created);
    return created.routes;
  };

  routesOf(inputs.showRegion).push({
    route: { source: 'show' },
    key: null,
    tunableLabel: '',
    detail: () => '',
  });
  for (const neighbour of inputs.neighbours) {
    if (neighbour.id === inputs.showRegion.id) {
      continue;
    }
    routesOf(neighbour).push({
      route: { source: 'neighbour', showRegionName: inputs.showRegion.name },
      key: 'promoPop.neighbourReach',
      tunableLabel: 'Neighbour reach',
      detail: (weight) => ` × ${formatNumber(weight)}`,
    });
  }
  for (const deal of inputs.deals) {
    for (const region of deal.regions) {
      routesOf(region).push({
        route: { source: 'tv', networkId: deal.networkId, networkName: deal.networkName },
        key: TV_REACH_KEYS[deal.reachTier],
        tunableLabel: `TV reach, tier ${String(deal.reachTier)}`,
        detail: (weight) => `, reach tier ${String(deal.reachTier)} × ${formatNumber(weight)}`,
      });
    }
  }

  const regions: ReachedRegion[] = [];
  for (const entry of byRegion.values()) {
    const { weight, strongest } = weighRegion(entry, tunables);
    if (weight.value <= 0) {
      continue;
    }
    regions.push({
      regionId: entry.region.id,
      regionName: entry.region.name,
      source: strongest.route.source,
      networkId: strongest.route.source === 'tv' ? strongest.route.networkId : null,
      label: reachLabel(strongest.route),
      weight,
    });
  }
  regions.sort(compareReached);
  return { regions };
}
