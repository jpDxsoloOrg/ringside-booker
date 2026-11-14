/**
 * Which deal airs which show (ECO8-01): the one rule settlement (ECO8-04), the calendar sheet
 * (ECO8-07) and show popularity's TV reach (EVT5) all read.
 *
 * - A deal is **in force** on a day when it is active, the day is in `[startsOn, endsOn)` and its
 *   network is active and not closed by then.
 * - A **definition-bound** deal airs only its own show.
 * - A **promotion-wide** deal (`eventDefinitionId: null`) airs every televised show of the
 *   promotion whose importance its network kind carries (pay-per-view: major and flagship only;
 *   TV and streaming: minor and up), unless a definition-bound deal of the same promotion and
 *   network kind is in force for that show: the specific deal beats the general one.
 * - A **house** show never airs.
 *
 * Shows are dated `eventInstances` rows, matched by `airDate` (a taped show airs on its air date,
 * not its taping day). A definition with no instance at all (a world without the calendar) airs
 * straight from its recurrence; once a definition has any instance the calendar owns it, and a day
 * without an instance means no show.
 *
 * Everything here is pure and read-only. Design: docs/design/broadcast.md#which-deal-airs-which-show.
 */

import { compareDates, type GameDate } from '../../core/date';
import type { PromotionId, RegionId } from '../../core/ids';
import type { Deal } from '../../model/entities/deal';
import type { EventDefinition, EventImportance } from '../../model/entities/event-definition';
import type { EventInstance } from '../../model/entities/event-instance';
import type { LedgerCategory } from '../../model/entities/ledger-entry';
import { coveredRegionIds, type Network, type NetworkKind } from '../../model/entities/network';
import { occursOn } from '../../model/recurrence';
import { compareIds } from '../../model/table';
import type { GameWorldView } from '../../model/tables';
import type { EngineTunables } from '../tunables';

/** The importances each kind of network airs. A house show is never on any of them. */
export const BROADCAST_ELIGIBLE_IMPORTANCE: Readonly<
  Record<NetworkKind, readonly EventImportance[]>
> = {
  tv: ['minor', 'regular', 'major', 'flagship'],
  streaming: ['minor', 'regular', 'major', 'flagship'],
  ppv: ['major', 'flagship'],
};

/** How a show reaches its audience: on TV, on pay-per-view or streamed. */
export const AIRING_KINDS = ['tv', 'ppv', 'streaming'] as const;
export type AiringKind = (typeof AIRING_KINDS)[number];

/** Plain words for each airing kind. */
export const AIRING_KIND_LABELS: Readonly<Record<AiringKind, string>> = {
  tv: 'On TV',
  ppv: 'On pay-per-view',
  streaming: 'Streaming',
};

/** The kind of airing a network gives a show. */
export function airingKindOf(kind: NetworkKind): AiringKind {
  return kind;
}

/** The ledger income category a network kind's money is posted under. */
export function incomeCategoryFor(kind: NetworkKind): LedgerCategory {
  switch (kind) {
    case 'tv':
      return 'broadcast';
    case 'ppv':
      return 'ppv';
    case 'streaming':
      return 'streaming';
  }
}

/**
 * The ledger category an airing's airtime cost is posted under. Airtime is a production cost of
 * being on TV; ECO10's own streaming service uses `networkUpkeep` instead.
 */
export const AIRTIME_COST_CATEGORY: LedgerCategory = 'production';

/** True when the network is active and has not closed by `date`. */
export function networkOnAir(network: Network, date: GameDate): boolean {
  return (
    network.status === 'active' &&
    (network.closedOn === null || compareDates(date, network.closedOn) < 0)
  );
}

/**
 * True when the deal airs shows on `date`: it is active, `startsOn ≤ date < endsOn`, and its
 * network is active and not closed on `date`.
 */
export function dealInForce(deal: Deal, network: Network, date: GameDate): boolean {
  return (
    deal.status === 'active' &&
    compareDates(deal.startsOn, date) <= 0 &&
    compareDates(date, deal.endsOn) < 0 &&
    networkOnAir(network, date)
  );
}

/** A show a deal could air: a dated show, or a definition on one of its recurrence dates. */
export type BroadcastShow =
  EventInstance | { readonly definition: EventDefinition; readonly airDate: GameDate };

interface ShowFacts {
  readonly promotionId: PromotionId;
  readonly eventDefinitionId: EventDefinition['id'] | null;
  readonly importance: EventImportance;
  readonly televised: boolean;
  readonly airDate: GameDate;
}

function showFacts(read: GameWorldView, show: BroadcastShow): ShowFacts {
  if ('definition' in show) {
    const { definition } = show;
    return {
      promotionId: definition.promotionId,
      eventDefinitionId: definition.id,
      importance: definition.importance,
      televised: definition.televised,
      airDate: show.airDate,
    };
  }
  const definition =
    show.eventDefinitionId === null
      ? undefined
      : read.tables.eventDefinitions.get(show.eventDefinitionId);
  return {
    promotionId: show.promotionId,
    eventDefinitionId: show.eventDefinitionId,
    // The instance's own copy: a show keeps the importance it was scheduled with.
    importance: show.importance,
    // A one-off has no definition to say; its importance decides (a house show never airs).
    televised: definition?.televised ?? true,
    airDate: show.airDate,
  };
}

/** True when a definition-bound deal of the same promotion and network kind is in force for it. */
function hasSpecificDeal(read: GameWorldView, kind: NetworkKind, facts: ShowFacts): boolean {
  if (facts.eventDefinitionId === null) {
    return false;
  }
  return read.tables.deals.lookup('byPromotion', facts.promotionId).some((other) => {
    if (other.eventDefinitionId !== facts.eventDefinitionId) {
      return false;
    }
    const network = read.tables.networks.get(other.networkId);
    return network?.kind === kind && dealInForce(other, network, facts.airDate);
  });
}

/**
 * True when `deal` (on `network`) covers `show`. It does not check that the deal is in force:
 * callers that list what airs use {@link dealsAiringShow} or {@link airingsDueOn}.
 */
export function dealCoversShow(
  read: GameWorldView,
  deal: Deal,
  network: Network,
  show: BroadcastShow,
): boolean {
  const facts = showFacts(read, show);
  if (deal.promotionId !== facts.promotionId || facts.importance === 'house') {
    return false;
  }
  if (deal.eventDefinitionId !== null) {
    return deal.eventDefinitionId === facts.eventDefinitionId;
  }
  return (
    facts.televised &&
    BROADCAST_ELIGIBLE_IMPORTANCE[network.kind].includes(facts.importance) &&
    !hasSpecificDeal(read, network.kind, facts)
  );
}

interface DealWithNetwork {
  readonly deal: Deal;
  readonly network: Network;
}

function dealsInForceAiring(
  read: GameWorldView,
  promotionId: PromotionId,
  show: BroadcastShow,
): DealWithNetwork[] {
  const airing: DealWithNetwork[] = [];
  for (const deal of read.tables.deals.lookup('byPromotion', promotionId)) {
    const network = read.tables.networks.get(deal.networkId);
    if (
      network !== undefined &&
      dealInForce(deal, network, show.airDate) &&
      dealCoversShow(read, deal, network, show)
    ) {
      airing.push({ deal, network });
    }
  }
  return airing;
}

/** Every deal that airs a dated show, on its `airDate`, in deal-id order. */
export function dealsAiringShow(read: GameWorldView, instance: EventInstance): Deal[] {
  return dealsInForceAiring(read, instance.promotionId, instance).map(({ deal }) => deal);
}

/** One show a deal airs today: from a dated show, or from a definition without the calendar. */
export type DueAiring =
  | {
      readonly deal: Deal;
      readonly network: Network;
      readonly source: 'instance';
      readonly instance: EventInstance;
    }
  | {
      readonly deal: Deal;
      readonly network: Network;
      readonly source: 'definition';
      readonly definition: EventDefinition;
    };

function dueShowId(due: DueAiring): string {
  return due.source === 'instance' ? due.instance.id : due.definition.id;
}

/** True when a definition runs on `date`: inside its active dates and on its recurrence. */
function definitionRunsOn(definition: EventDefinition, date: GameDate): boolean {
  return (
    compareDates(definition.activeFrom, date) <= 0 &&
    (definition.activeUntil === null || compareDates(date, definition.activeUntil) <= 0) &&
    occursOn(definition.recurrence, date)
  );
}

/**
 * Every show a deal airs on `date`, in deal-id then show order. Dated shows count whatever their
 * status (settlement decides aired or missed); a definition with no dated show at all airs on its
 * recurrence dates.
 */
export function airingsDueOn(read: GameWorldView, date: GameDate): DueAiring[] {
  const due: DueAiring[] = [];
  for (const instance of read.tables.eventInstances.lookup('byAirDate', date)) {
    for (const { deal, network } of dealsInForceAiring(read, instance.promotionId, instance)) {
      due.push({ deal, network, source: 'instance', instance });
    }
  }
  const instances = read.tables.eventInstances;
  for (const definition of read.tables.eventDefinitions.values()) {
    if (
      !definitionRunsOn(definition, date) ||
      instances.lookup('byDefinition', definition.id).length > 0
    ) {
      continue;
    }
    const show = { definition, airDate: date };
    for (const { deal, network } of dealsInForceAiring(read, definition.promotionId, show)) {
      due.push({ deal, network, source: 'definition', definition });
    }
  }
  return due.sort(
    (left, right) =>
      compareIds(left.deal.id, right.deal.id) || compareIds(dueShowId(left), dueShowId(right)),
  );
}

/**
 * The regions a promotion's market covers: its home region and every region where its popularity
 * is at least `broadcast.networks.minPopularityToList` (0 lists every region), in ID order.
 */
export function promotionMarketRegionIds(
  read: GameWorldView,
  promotionId: PromotionId,
  tunables: EngineTunables,
): RegionId[] {
  const promotion = read.tables.promotions.require(promotionId);
  const minimum = tunables.get('broadcast.networks.minPopularityToList');
  if (minimum <= 0) {
    return [...read.tables.regions.ids()];
  }
  return read.tables.regions
    .ids()
    .filter(
      (regionId) =>
        regionId === promotion.homeRegionId || (promotion.regionalPop[regionId] ?? 0) >= minimum,
    );
}

/**
 * The networks a promotion can deal with: active networks (on the world's current date) that
 * cover at least one region of its market, leaving out other promotions' own services. ID order.
 */
export function networksCovering(
  read: GameWorldView,
  promotionId: PromotionId,
  tunables: EngineTunables,
): Network[] {
  const market = new Set(promotionMarketRegionIds(read, promotionId, tunables));
  const today = read.meta.currentDate;
  return read.tables.networks
    .values()
    .filter(
      (network) =>
        networkOnAir(network, today) &&
        (network.ownerPromotionId === null || network.ownerPromotionId === promotionId) &&
        coveredRegionIds(network, read).some((regionId) => market.has(regionId)),
    );
}

/**
 * The promotion's deal in force on `date` with the lowest id, or null. ECO7's camera minimum
 * (`production/deals.ts`) reads this, so the camera floor holds exactly while a deal airs shows.
 */
export function firstDealInForce(
  read: GameWorldView,
  promotionId: PromotionId,
  date: GameDate,
): Deal | null {
  // `lookup` lists rows in ascending id order, so the first match is the lowest id.
  return (
    read.tables.deals.lookup('byPromotion', promotionId).find((deal) => {
      const network = read.tables.networks.get(deal.networkId);
      return network !== undefined && dealInForce(deal, network, date);
    }) ?? null
  );
}

/** True when the promotion has a deal in force on `date` (ECO7's camera rule reads it). */
export function hasActiveBroadcastDeal(
  read: GameWorldView,
  promotionId: PromotionId,
  date: GameDate,
): boolean {
  return firstDealInForce(read, promotionId, date) !== null;
}
