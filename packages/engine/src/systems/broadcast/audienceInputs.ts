/**
 * The world reads behind the audience formula (ECO8-02): the formulas take plain values, and these
 * builders read them from the world. `projectedAudience` and `benchmarkFor` are the audience helper
 * other features call (valuation, deal health, EVT5's TV reach, DAY4, BRW5, ECO10).
 *
 * Nothing is cached between calls (no module state), so the same world always gives the same
 * numbers. Design: docs/design/broadcast.md#audience.
 */

import type { EventInstanceId, NetworkId, PromotionId, RegionId } from '../../core/ids';
import type { Traced } from '../../core/trace';
import type { DealTimeslot } from '../../model/entities/deal';
import type { EventImportance } from '../../model/entities/event-definition';
import { coveredRegionIds, type Network } from '../../model/entities/network';
import type { GameWorldView } from '../../model/tables';
import type { EngineTunables } from '../tunables';
import { geographyOf } from '../world/geography';
import {
  audience,
  type AudienceInputs,
  type AudienceQuality,
  type RegionAudienceInput,
} from './formulas/audience';
import {
  networkBenchmark,
  type BenchmarkRegionInput,
  type NetworkBenchmarkInputs,
} from './formulas/networkBenchmark';

/** What a show on a network is: the promotion, the network and how it airs. */
export interface AudienceRequest {
  readonly promotionId: PromotionId;
  readonly networkId: NetworkId;
  readonly timeslot: DealTimeslot;
  readonly live: boolean;
  readonly importance: EventImportance;
  /** The show, for its hype; null or left out for a show not yet dated. */
  readonly eventInstanceId?: EventInstanceId | null;
  /** How good the show was; null or left out for neutral quality. */
  readonly quality?: AudienceQuality | null;
  /** Roll the night-to-night swing (airings only). */
  readonly swing?: boolean;
}

/** What a network is asked to expect: the network and the slot, without a promotion. */
export interface BenchmarkRequest {
  readonly networkId: NetworkId;
  readonly timeslot: DealTimeslot;
  readonly importance: EventImportance;
}

/**
 * The hype multiplier for a show, or null while hype isn't tracked. The one seam ECO3's integration
 * ticket points at `hypeMultiplierFor` (ECO3 was not on main when ECO8-07 wired the partners);
 * until then the audience says "Hype isn't tracked yet".
 */
/* eslint-disable @typescript-eslint/no-unused-vars -- the seam keeps ECO3's signature for ECO3 */
export function broadcastHypeFor(
  _read: GameWorldView,
  _tunables: EngineTunables,
  _promotionId: PromotionId,
  _eventInstanceId: EventInstanceId | null,
): Traced<number> | null {
  /* eslint-enable @typescript-eslint/no-unused-vars */
  return null;
}

interface CoveredRegion {
  readonly regionId: RegionId;
  readonly input: BenchmarkRegionInput;
}

/** Every region the network covers, with its people, interest and country, in region-ID order. */
function coverageRegions(read: GameWorldView, network: Network): CoveredRegion[] {
  const geography = geographyOf(read);
  return coveredRegionIds(network, read).map((regionId) => {
    const region = geography.region(regionId);
    return {
      regionId,
      input: {
        regionName: region.name,
        regionRef: { kind: 'region', id: region.id },
        population: region.population,
        wrestlingInterest: region.wrestlingInterest,
        countryName: geography.country(region.countryId).name,
      },
    };
  });
}

/** The audience formula's inputs for a promotion's show on a network. */
export function audienceInputsFor(
  read: GameWorldView,
  tunables: EngineTunables,
  request: AudienceRequest,
): AudienceInputs {
  const promotion = read.tables.promotions.require(request.promotionId);
  const network = read.tables.networks.require(request.networkId);
  const eventInstanceId = request.eventInstanceId ?? null;
  const regions: RegionAudienceInput[] = coverageRegions(read, network).map((region) => ({
    ...region.input,
    popularity: promotion.regionalPop[region.regionId] ?? 0,
  }));
  return {
    regions,
    networkName: network.name,
    reachTier: network.reachTier,
    kind: network.kind,
    timeslot: request.timeslot,
    live: request.live,
    importance: request.importance,
    marketingLevel: promotion.production.marketing,
    hype: broadcastHypeFor(read, tunables, promotion.id, eventInstanceId),
    quality: request.quality ?? null,
    swing: request.swing ?? false,
  };
}

/** The network benchmark's inputs: the network's coverage and the slot. */
export function benchmarkInputsFor(
  read: GameWorldView,
  request: BenchmarkRequest,
): NetworkBenchmarkInputs {
  const network = read.tables.networks.require(request.networkId);
  return {
    regions: coverageRegions(read, network).map((region) => region.input),
    networkName: network.name,
    reachTier: network.reachTier,
    kind: network.kind,
    timeslot: request.timeslot,
    importance: request.importance,
  };
}

/**
 * The audience a promotion's show would draw on a network today: neutral quality, the current
 * hype, no swing. Valuation and every "how many would watch" preview read this.
 */
export function projectedAudience(
  read: GameWorldView,
  tunables: EngineTunables,
  request: Pick<AudienceRequest, 'promotionId' | 'networkId' | 'timeslot' | 'live' | 'importance'>,
): Traced<number> {
  const inputs = audienceInputsFor(read, tunables, {
    promotionId: request.promotionId,
    networkId: request.networkId,
    timeslot: request.timeslot,
    live: request.live,
    importance: request.importance,
  });
  return audience(inputs, { tunables });
}

/** What the network expects a typical promotion's show in that slot to draw. Never rolls. */
export function benchmarkFor(
  read: GameWorldView,
  tunables: EngineTunables,
  request: BenchmarkRequest,
): Traced<number> {
  return networkBenchmark(benchmarkInputsFor(read, request), { tunables });
}
