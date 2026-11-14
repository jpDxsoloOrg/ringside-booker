/**
 * Deal valuation (ECO8-03): what a network would pay for a show and whether it would sign, from
 * the same inputs every time. It projects the audience (ECO8-02), compares it to the network's
 * benchmark, turns that into terms (`dealTerms`) and runs the named checks (`dealVerdict`).
 *
 * A pure read: no randomness, no trace store writes, nothing cached. The preview a player sees is
 * exactly what a proposal (ECO8-05) signs, and rivals' deal-making (ECO10) calls the same function.
 *
 * Design: docs/design/broadcast.md#valuation.
 */

import { addMonths, compareDates, type GameDate, type Weekday } from '../../core/date';
import type { DealId, EventDefinitionId, NetworkId, PromotionId, RegionId } from '../../core/ids';
import { startCalc, type Traced, type TraceNode } from '../../core/trace';
import type { Deal, DealTimeslot } from '../../model/entities/deal';
import {
  EVENT_IMPORTANCES,
  type EventDefinition,
  type EventImportance,
} from '../../model/entities/event-definition';
import { coveredRegionIds, type Network } from '../../model/entities/network';
import type { GameWorldView } from '../../model/tables';
import { reachOf } from '../finance/reach';
import type { EngineTunables } from '../tunables';
import { benchmarkFor, projectedAudience } from './audienceInputs';
import { networkOnAir, promotionMarketRegionIds } from './coverage';
import { dealTerms, VALUATION_DOC_REF } from './formulas/dealTerms';
import { dealVerdict, type DealRefusal, type DealVerdictValue } from './formulas/dealVerdict';

/** What is being valued: a show (or every show) of a promotion on a network, in a slot. */
export interface DealValuationRequest {
  readonly promotionId: PromotionId;
  readonly networkId: NetworkId;
  /** The show, or null for a promotion-wide deal. */
  readonly eventDefinitionId: EventDefinitionId | null;
  readonly timeslot: DealTimeslot;
  readonly live: boolean;
  readonly months: number;
  /** A deal to ignore in the "already on" and "slot taken" checks (renegotiation). */
  readonly excludeDealId?: DealId | null;
}

/** The terms a network would offer, all money in whole cents, each with its Why?. */
export interface DealValuationTerms {
  readonly feePerShow: Traced<number>;
  readonly perThousandViewers: Traced<number>;
  readonly costPerShow: Traced<number>;
}

/** What a network would pay for a show and whether it would sign. Plain JSON. */
export interface DealValuation {
  readonly verdict: DealVerdictValue;
  /** Every failing check, in check order; empty on accept. */
  readonly refusals: readonly DealRefusal[];
  readonly projectedViewers: Traced<number>;
  readonly benchmark: Traced<number>;
  readonly ratio: Traced<number>;
  readonly terms: DealValuationTerms;
  /** Fee + per-thousand × projected ÷ 1,000 − airtime. Can be negative. */
  readonly incomePerAiring: Traced<number>;
  readonly importance: EventImportance;
  /** The show's weekday (0 = Monday), or null when the deal is not tied to one. */
  readonly weekday: Weekday | null;
  readonly startsOn: GameDate;
  readonly endsOn: GameDate;
  /** The show is not televised yet: signing makes it a TV show (ECO8-05). */
  readonly becomesTelevised: boolean;
  readonly verdictTrace: TraceNode;
}

/** The name a promotion-wide deal goes by. */
export const ALL_MAJOR_SHOWS = 'All major shows';
export const ALL_TELEVISED_SHOWS = 'All televised shows';

export const HOUSE_SHOW_NOTE = "House shows aren't televised: nobody watches on TV";
export const AIRTIME_LOSS_NOTE = 'Airtime costs more than this deal pays: every airing loses money';

/**
 * The Production screen (ECO7) can raise the camera level, so the camera refusal says how to fix
 * it.
 */
const CAMERA_CAN_BE_RAISED = true;

/** "All major shows" for a promotion-wide pay-per-view deal, "All televised shows" otherwise. */
export function promotionWideShowName(network: Pick<Network, 'kind'>): string {
  return network.kind === 'ppv' ? ALL_MAJOR_SHOWS : ALL_TELEVISED_SHOWS;
}

/** The show a deal airs, by name. */
export function dealShowName(read: GameWorldView, deal: Deal, network: Network): string {
  if (deal.eventDefinitionId === null) {
    return promotionWideShowName(network);
  }
  return read.tables.eventDefinitions.get(deal.eventDefinitionId)?.name ?? 'A show';
}

/** True when the deal is signed and has not ended by `today` (it may not have started yet). */
export function dealIsLive(deal: Deal, today: GameDate): boolean {
  return deal.status === 'active' && compareDates(today, deal.endsOn) < 0;
}

function importanceRank(importance: EventImportance): number {
  return EVENT_IMPORTANCES.indexOf(importance);
}

function definitionIsCurrent(definition: EventDefinition, today: GameDate): boolean {
  return definition.activeUntil === null || compareDates(today, definition.activeUntil) <= 0;
}

function isWeeklyShow(definition: EventDefinition): boolean {
  return definition.recurrence.kind === 'weekly' || definition.recurrence.kind === 'everyNWeeks';
}

/**
 * The importance a promotion-wide deal is valued at: major on pay-per-view; on TV or streaming,
 * the promotion's most important weekly televised show (minor when it has none).
 */
export function promotionWideImportance(
  read: GameWorldView,
  promotionId: PromotionId,
  network: Pick<Network, 'kind'>,
): EventImportance {
  if (network.kind === 'ppv') {
    return 'major';
  }
  const today = read.meta.currentDate;
  let best: EventImportance = 'minor';
  for (const definition of read.tables.eventDefinitions.lookup('byPromotion', promotionId)) {
    if (
      definition.televised &&
      definition.importance !== 'house' &&
      isWeeklyShow(definition) &&
      definitionIsCurrent(definition, today) &&
      importanceRank(definition.importance) > importanceRank(best)
    ) {
      best = definition.importance;
    }
  }
  return best;
}

/** The weekday a show airs on (the first, for a show on several days), or null. */
export function definitionWeekday(definition: EventDefinition | null): Weekday | null {
  if (definition === null) {
    return null;
  }
  const { recurrence } = definition;
  switch (recurrence.kind) {
    case 'weekly':
      return recurrence.weekdays[0] ?? null;
    case 'everyNWeeks':
      return recurrence.weekday;
    default:
      return null;
  }
}

/** People living in the regions a network covers (its covered regions, when already known). */
export function coveredPopulation(
  read: GameWorldView,
  network: Network,
  regionIds: readonly RegionId[] = coveredRegionIds(network, read),
): number {
  let people = 0;
  for (const regionId of regionIds) {
    people += read.tables.regions.get(regionId)?.population ?? 0;
  }
  return people;
}

function coversAny(read: GameWorldView, network: Network, regions: ReadonlySet<RegionId>): boolean {
  return coveredRegionIds(network, read).some((regionId) => regions.has(regionId));
}

/** A projected audience and the network's benchmark for one slot. */
interface SlotAudience {
  readonly projected: Traced<number>;
  readonly benchmark: Traced<number>;
}

/**
 * Facts about the promotion a caller valuing many deals in one read has already worked out
 * (`broadcast.networks`), so each valuation does not redo them. Every field is optional; a
 * valuation without a context works them out itself and gives the same result.
 */
export interface ValuationContext {
  /** The promotion's ECO1 reach. */
  readonly reach?: Traced<number>;
  /** The promotion's market regions (`promotionMarketRegionIds`). */
  readonly marketRegionIds?: ReadonlySet<RegionId>;
  /**
   * Audiences worked out earlier in the same read, by network, slot, live and importance. The
   * valuation adds to it. Only share it within one read of one world.
   */
  readonly audiences?: Map<string, SlotAudience>;
}

/** A fresh context for valuing many deals of one promotion in one read. */
export function valuationContext(
  read: GameWorldView,
  tunables: EngineTunables,
  promotionId: PromotionId,
): ValuationContext {
  return {
    reach: reachOf(read, promotionId, tunables).reach,
    marketRegionIds: new Set(promotionMarketRegionIds(read, promotionId, tunables)),
    audiences: new Map(),
  };
}

/** True when the network is for every promotion, or the promotion's own service. */
function openTo(network: Network, promotionId: PromotionId): boolean {
  return network.ownerPromotionId === null || network.ownerPromotionId === promotionId;
}

function zeroAudience(label: string): Traced<number> {
  return startCalc(label, 0, {
    unit: 'count',
    docRef: VALUATION_DOC_REF,
    startLabel: HOUSE_SHOW_NOTE,
  }).done();
}

interface ConflictFacts {
  readonly alreadyOnNetwork: boolean;
  readonly overlapNetworkName: string | null;
  readonly slotTakenBy: string | null;
}

function conflicts(
  read: GameWorldView,
  request: DealValuationRequest,
  network: Network,
  regions: ReadonlySet<RegionId>,
  weekday: Weekday | null,
): ConflictFacts {
  const today = read.meta.currentDate;
  const excluded = request.excludeDealId ?? null;
  const ownDeals = read.tables.deals
    .lookup('byPromotion', request.promotionId)
    .filter((deal) => deal.id !== excluded && dealIsLive(deal, today));
  const sameShow = ownDeals.filter((deal) => deal.eventDefinitionId === request.eventDefinitionId);
  const alreadyOnNetwork = sameShow.some((deal) => deal.networkId === network.id);

  let overlapNetworkName: string | null = null;
  for (const deal of sameShow) {
    const other = read.tables.networks.get(deal.networkId);
    if (
      other !== undefined &&
      other.id !== network.id &&
      other.kind === network.kind &&
      coversAny(read, other, regions)
    ) {
      overlapNetworkName = other.name;
      break;
    }
  }

  let slotTakenBy: string | null = null;
  if (network.kind !== 'ppv' && weekday !== null) {
    for (const deal of read.tables.deals.lookup('byNetwork', network.id)) {
      const sameDeal =
        deal.promotionId === request.promotionId &&
        deal.eventDefinitionId === request.eventDefinitionId;
      if (
        deal.id !== excluded &&
        !sameDeal &&
        dealIsLive(deal, today) &&
        deal.timeslot === request.timeslot &&
        deal.weekday === weekday
      ) {
        slotTakenBy = dealShowName(read, deal, network);
        break;
      }
    }
  }
  return { alreadyOnNetwork, overlapNetworkName, slotTakenBy };
}

function incomePerAiring(
  kind: Network['kind'],
  projected: Traced<number>,
  terms: DealValuationTerms,
): Traced<number> {
  const perThousandLabel = kind === 'ppv' ? 'Paid for the buys' : 'Paid for the viewers';
  const perThousand = startCalc(perThousandLabel, projected, {
    unit: 'money',
    docRef: VALUATION_DOC_REF,
  })
    .divide('Counted in thousands', 1_000)
    .multiply(
      kind === 'ppv' ? 'Paid per thousand buys' : 'Paid per thousand viewers',
      terms.perThousandViewers,
    )
    .round('floor', 'Rounded down to the cent')
    .done();
  const calc = startCalc('Income per airing', terms.feePerShow, {
    unit: 'money',
    docRef: VALUATION_DOC_REF,
  })
    .add(perThousandLabel, perThousand)
    .subtract('Airtime', terms.costPerShow);
  if (calc.current < 0) {
    calc.note(AIRTIME_LOSS_NOTE);
  }
  return calc.done();
}

/** The projected audience and the benchmark, from the cache when this slot was worked out. */
function slotAudience(
  read: GameWorldView,
  tunables: EngineTunables,
  slot: {
    readonly request: DealValuationRequest;
    readonly network: Network;
    readonly importance: EventImportance;
    readonly showName: string;
  },
  cache: Map<string, SlotAudience> | undefined,
): SlotAudience {
  const { request, network, importance, showName } = slot;
  if (importance === 'house') {
    return {
      projected: zeroAudience(`Viewers ${showName} would draw on ${network.name}`),
      benchmark: zeroAudience(`What ${network.name} expects`),
    };
  }
  const key = [
    request.promotionId,
    network.id,
    request.timeslot,
    String(request.live),
    importance,
  ].join('|');
  const cached = cache?.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const audience: SlotAudience = {
    projected: projectedAudience(read, tunables, {
      promotionId: request.promotionId,
      networkId: network.id,
      timeslot: request.timeslot,
      live: request.live,
      importance,
    }),
    benchmark: benchmarkFor(read, tunables, {
      networkId: network.id,
      timeslot: request.timeslot,
      importance,
    }),
  };
  cache?.set(key, audience);
  return audience;
}

/**
 * What the network would pay for the show and whether it would sign. Deterministic: the same
 * world and request always give the same verdict, terms and traces.
 *
 * @throws EntityNotFoundError when the promotion, network or show is not in the world.
 */
export function dealValuation(
  read: GameWorldView,
  tunables: EngineTunables,
  request: DealValuationRequest,
  context: ValuationContext = {},
): DealValuation {
  const today = read.meta.currentDate;
  const promotion = read.tables.promotions.require(request.promotionId);
  const network = read.tables.networks.require(request.networkId);
  const definition =
    request.eventDefinitionId === null
      ? null
      : read.tables.eventDefinitions.require(request.eventDefinitionId);
  const importance = definition?.importance ?? promotionWideImportance(read, promotion.id, network);
  const showName = definition?.name ?? promotionWideShowName(network);
  const weekday = definitionWeekday(definition);

  const { projected: projectedViewers, benchmark } = slotAudience(
    read,
    tunables,
    { request, network, importance, showName },
    context.audiences,
  );
  const coveredIds = coveredRegionIds(network, read);

  const { ratio, ...terms } = dealTerms(
    {
      kind: network.kind,
      live: request.live,
      projected: projectedViewers,
      benchmark,
      coveredPopulation: coveredPopulation(read, network, coveredIds),
      reachTier: network.reachTier,
      networkName: network.name,
    },
    { tunables },
  );

  const market =
    context.marketRegionIds ?? new Set(promotionMarketRegionIds(read, promotion.id, tunables));
  const primeTimeAsked = network.kind !== 'ppv' && request.timeslot === 'primeTime';
  const verdict = dealVerdict(
    {
      networkName: network.name,
      kind: network.kind,
      reachTier: network.reachTier,
      showName,
      importance,
      timeslot: request.timeslot,
      networkOnAir: networkOnAir(network, today),
      inMarket:
        openTo(network, promotion.id) && coveredIds.some((regionId) => market.has(regionId)),
      ...conflicts(read, request, network, new Set(coveredIds), weekday),
      reach: primeTimeAsked ? (context.reach ?? reachOf(read, promotion.id, tunables).reach) : null,
      camera: promotion.production.camera,
      projected: projectedViewers.value,
      ratio,
      months: request.months,
      cameraCanBeRaised: CAMERA_CAN_BE_RAISED,
    },
    { tunables },
  );

  return {
    verdict: verdict.value,
    refusals: verdict.refusals,
    projectedViewers,
    benchmark,
    ratio,
    terms,
    incomePerAiring: incomePerAiring(network.kind, projectedViewers, terms),
    importance,
    weekday,
    startsOn: today,
    endsOn: addMonths(today, Math.max(1, Math.trunc(request.months))),
    becomesTelevised: definition !== null && !definition.televised,
    verdictTrace: verdict.trace,
  };
}
