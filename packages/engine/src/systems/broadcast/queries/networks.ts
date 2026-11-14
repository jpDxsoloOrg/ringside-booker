/**
 * The broadcast read side (ECO8-03): which networks a promotion can deal with and what they
 * already carry (`broadcast.networks`), a valuation preview for any show, slot, live and length
 * (`broadcast.valuation`), and any promotion's deals as the public sees them
 * (`broadcast.publicDeals`).
 *
 * Visibility: that a deal exists is public (who airs what, where and when); its money is not.
 * `broadcast.networks` and `broadcast.valuation` are for the viewer's own promotions only;
 * `broadcast.publicDeals` works for any promotion and carries no money at all.
 *
 * Design: docs/design/broadcast.md#queries-and-visibility.
 */

import { z } from 'zod';
import { viewerPromotionIds, type Viewer } from '../../../core/api/controller';
import { defineQuery, type QueryDefinition } from '../../../core/api/query';
import { refuseQuery } from '../../../core/api/result';
import { compareDates, type GameDate, type Weekday } from '../../../core/date';
import type { DealId, EventDefinitionId, NetworkId, PromotionId } from '../../../core/ids';
import { DealTimeslotSchema, type DealTimeslot } from '../../../model/entities/deal';
import { EVENT_IMPORTANCES, type EventDefinition } from '../../../model/entities/event-definition';
import type { Network, NetworkKind } from '../../../model/entities/network';
import { compareIds } from '../../../model/table';
import { zId, type ImageRef } from '../../../model/primitives';
import type { GameWorldView } from '../../../model/tables';
import { reachOf } from '../../finance/reach';
import type { EngineTunables } from '../../tunables';
import { BROADCAST_ELIGIBLE_IMPORTANCE, networksCovering } from '../coverage';
import type { DealRefusal, DealVerdictValue } from '../formulas/dealVerdict';
import {
  coveredPopulation,
  dealIsLive,
  dealShowName,
  dealValuation,
  type DealValuation,
} from '../valuation';

export const NOT_YOUR_PROMOTION = 'notYourPromotion';
export const UNKNOWN_PROMOTION = 'unknownPromotion';
export const UNKNOWN_NETWORK = 'unknownNetwork';
export const UNKNOWN_SHOW = 'unknownShow';
export const NOT_YOUR_SHOW = 'notYourShow';
export const UNKNOWN_DEAL = 'unknownDeal';

/**
 * The most valuations `bestOffer` runs for one network row. Keeps the tab under 50 ms on the
 * default world.
 */
export const BEST_OFFER_MAX_VALUATIONS = 6;

/** How many coverage names a label lists before "+N". */
const COVERAGE_LABEL_NAMES = 2;

/** A deal a network already carries, as anyone may see it: no money. */
export interface NetworkCarriedDeal {
  dealId: DealId;
  promotionName: string;
  /** The show's name, or "All major shows" / "All televised shows" for a promotion-wide deal. */
  showName: string;
  weekday: Weekday | null;
  timeslot: DealTimeslot;
}

/** The best deal a network would offer for one of the promotion's shows. */
export interface NetworkBestOffer {
  /** The show, or null for a promotion-wide deal. */
  eventDefinitionId: EventDefinitionId | null;
  timeslot: DealTimeslot;
  verdict: DealVerdictValue;
  /** In cents. */
  feePerShow: number;
  /** In cents; can be negative. */
  incomePerAiring: number;
  /** The first reason it would refuse, or null when it would sign. */
  firstRefusal: DealRefusal | null;
}

/** One row of `broadcast.networks`. */
export interface NetworkRow {
  networkId: NetworkId;
  name: string;
  kind: NetworkKind;
  reachTier: number;
  logoRef: ImageRef;
  /** "United States", "Texas", "North America, Europe +3". */
  coverageLabel: string;
  coveredPopulation: number;
  /** Every live deal on the network, the promotion's own included. Public: no money. */
  carries: NetworkCarriedDeal[];
  /** The promotion's own live deals on this network. */
  yourDeals: DealId[];
  /** The best offer for a show not yet on this network, or null when there is none to value. */
  bestOffer: NetworkBestOffer | null;
}

/** One row of `broadcast.publicDeals`: a deal as the public sees it. No money, no viewers. */
export interface PublicDealRow {
  dealId: DealId;
  networkName: string;
  kind: NetworkKind;
  showName: string;
  weekday: Weekday | null;
  timeslot: DealTimeslot;
  live: boolean;
  startsOn: GameDate;
  endsOn: GameDate;
}

/** `broadcast.valuation`'s arguments: `dealValuation`'s, with `dealId` for a renegotiation. */
export interface BroadcastValuationArgs {
  promotionId: PromotionId;
  networkId: NetworkId;
  eventDefinitionId: EventDefinitionId | null;
  timeslot: DealTimeslot;
  live: boolean;
  months: number;
  /** The deal being renegotiated: it is left out of the "already on" and "slot taken" checks. */
  dealId?: DealId;
}

declare module '../../../core/api/maps' {
  interface QueryMap {
    'broadcast.networks': { args: { promotionId: PromotionId }; result: NetworkRow[] };
    'broadcast.valuation': { args: BroadcastValuationArgs; result: DealValuation };
    'broadcast.publicDeals': { args: { promotionId: PromotionId }; result: PublicDealRow[] };
  }
}

/** Refuses unless the viewer runs the promotion (or sees everything). */
function requireOwnPromotion(read: GameWorldView, viewer: Viewer, promotionId: PromotionId): void {
  if (read.tables.promotions.get(promotionId) === undefined) {
    refuseQuery({
      code: UNKNOWN_PROMOTION,
      message: 'There is no such promotion',
      field: 'promotionId',
    });
  }
  if (viewer.kind === 'omniscient' || viewerPromotionIds(read, viewer).includes(promotionId)) {
    return;
  }
  refuseQuery({
    code: NOT_YOUR_PROMOTION,
    message: 'You can only look at TV deals for your own promotion',
    subject: { kind: 'promotion', id: promotionId },
  });
}

/** "United States", "Texas", "North America, Europe +3". */
export function coverageLabel(read: GameWorldView, network: Network): string {
  const { tables } = read;
  const names = [
    ...network.coverage.continentIds.map((id) => tables.continents.get(id)?.name),
    ...network.coverage.countryIds.map((id) => tables.countries.get(id)?.name),
    ...network.coverage.regionIds.map((id) => tables.regions.get(id)?.name),
  ].filter((name): name is string => name !== undefined);
  if (names.length <= COVERAGE_LABEL_NAMES) {
    return names.join(', ');
  }
  const shown = names.slice(0, COVERAGE_LABEL_NAMES).join(', ');
  return `${shown} +${String(names.length - COVERAGE_LABEL_NAMES)}`;
}

function importanceRank(definition: EventDefinition): number {
  return EVENT_IMPORTANCES.indexOf(definition.importance);
}

/**
 * The shows `bestOffer` values on a network: a promotion-wide deal first on pay-per-view, then the
 * promotion's current shows the network kind carries and that are not on it yet, most important
 * first, at most {@link BEST_OFFER_MAX_VALUATIONS}.
 */
function offerCandidates(
  read: GameWorldView,
  promotionId: PromotionId,
  network: Network,
  onNetwork: ReadonlySet<EventDefinitionId | null>,
): (EventDefinitionId | null)[] {
  const today = read.meta.currentDate;
  const eligible = BROADCAST_ELIGIBLE_IMPORTANCE[network.kind];
  const shows = read.tables.eventDefinitions
    .lookup('byPromotion', promotionId)
    .filter(
      (definition) =>
        eligible.includes(definition.importance) &&
        !onNetwork.has(definition.id) &&
        (definition.activeUntil === null || compareDates(today, definition.activeUntil) <= 0),
    )
    .sort(
      (left, right) =>
        importanceRank(right) - importanceRank(left) || compareIds(left.id, right.id),
    )
    .map((definition): EventDefinitionId | null => definition.id);
  const candidates = network.kind === 'ppv' && !onNetwork.has(null) ? [null, ...shows] : shows;
  return candidates.slice(0, BEST_OFFER_MAX_VALUATIONS);
}

/** Better first: an accepted offer beats a refused one; then income, then fewer refusals. */
function compareOffers(left: DealValuation, right: DealValuation): number {
  if (left.verdict !== right.verdict) {
    return left.verdict === 'accept' ? -1 : 1;
  }
  if (left.verdict === 'refuse' && left.refusals.length !== right.refusals.length) {
    return left.refusals.length - right.refusals.length;
  }
  if (left.verdict === 'refuse' && left.ratio.value !== right.ratio.value) {
    return right.ratio.value - left.ratio.value;
  }
  return right.incomePerAiring.value - left.incomePerAiring.value;
}

function bestOffer(
  read: GameWorldView,
  tunables: EngineTunables,
  promotionId: PromotionId,
  network: Network,
  primeTimeOpen: boolean,
  onNetwork: ReadonlySet<EventDefinitionId | null>,
): NetworkBestOffer | null {
  // The network's best slot the promotion may have: prime time once its reach allows it.
  const timeslot: DealTimeslot = network.kind === 'ppv' || primeTimeOpen ? 'primeTime' : 'evening';
  const months = tunables.get('broadcast.deal.defaultMonths');
  let best: { id: EventDefinitionId | null; valuation: DealValuation } | null = null;
  for (const eventDefinitionId of offerCandidates(read, promotionId, network, onNetwork)) {
    const valuation = dealValuation(read, tunables, {
      promotionId,
      networkId: network.id,
      eventDefinitionId,
      timeslot,
      live: false,
      months,
    });
    if (best === null || compareOffers(valuation, best.valuation) < 0) {
      best = { id: eventDefinitionId, valuation };
    }
  }
  if (best === null) {
    return null;
  }
  const { valuation } = best;
  return {
    eventDefinitionId: best.id,
    timeslot,
    verdict: valuation.verdict,
    feePerShow: valuation.terms.feePerShow.value,
    incomePerAiring: valuation.incomePerAiring.value,
    firstRefusal: valuation.refusals[0] ?? null,
  };
}

function networkRows(
  read: GameWorldView,
  tunables: EngineTunables,
  promotionId: PromotionId,
): NetworkRow[] {
  const today = read.meta.currentDate;
  const reach = reachOf(read, promotionId, tunables).reach.value;
  const primeTimeOpen = reach >= tunables.get('broadcast.deal.primeTimeMinReach');
  return networksCovering(read, promotionId, tunables)
    .sort(
      (left, right) =>
        left.reachTier - right.reachTier ||
        left.name.localeCompare(right.name) ||
        compareIds(left.id, right.id),
    )
    .map((network): NetworkRow => {
      const live = read.tables.deals
        .lookup('byNetwork', network.id)
        .filter((deal) => dealIsLive(deal, today));
      const own = live.filter((deal) => deal.promotionId === promotionId);
      const onNetwork = new Set(own.map((deal) => deal.eventDefinitionId));
      return {
        networkId: network.id,
        name: network.name,
        kind: network.kind,
        reachTier: network.reachTier,
        logoRef: network.logoRef,
        coverageLabel: coverageLabel(read, network),
        coveredPopulation: coveredPopulation(read, network),
        carries: live.map((deal) => ({
          dealId: deal.id,
          promotionName: read.tables.promotions.get(deal.promotionId)?.name ?? 'A promotion',
          showName: dealShowName(read, deal, network),
          weekday: deal.weekday,
          timeslot: deal.timeslot,
        })),
        yourDeals: own.map((deal) => deal.id),
        bestOffer: bestOffer(read, tunables, promotionId, network, primeTimeOpen, onNetwork),
      };
    });
}

export const networksQuery: QueryDefinition<'broadcast.networks'> = defineQuery(
  'broadcast.networks',
  {
    args: z.strictObject({ promotionId: zId('promotion') }),
    run: (ctx, args) => {
      requireOwnPromotion(ctx.read, ctx.viewer, args.promotionId);
      return networkRows(ctx.read, ctx.tunables, args.promotionId);
    },
  },
);

export const valuationQuery: QueryDefinition<'broadcast.valuation'> = defineQuery(
  'broadcast.valuation',
  {
    args: z.strictObject({
      promotionId: zId('promotion'),
      networkId: zId('network'),
      eventDefinitionId: zId('eventDefinition').nullable(),
      timeslot: DealTimeslotSchema,
      live: z.boolean(),
      // Any whole number of months: the verdict says when it is outside the allowed lengths.
      months: z.number().int().min(1).max(1200),
      dealId: zId('deal').exactOptional(),
    }),
    run: (ctx, args) => {
      const { read } = ctx;
      requireOwnPromotion(read, ctx.viewer, args.promotionId);
      const network = read.tables.networks.get(args.networkId);
      if (
        network === undefined ||
        (network.ownerPromotionId !== null && network.ownerPromotionId !== args.promotionId)
      ) {
        return refuseQuery({
          code: UNKNOWN_NETWORK,
          message: 'There is no such network to deal with',
          field: 'networkId',
        });
      }
      if (args.eventDefinitionId !== null) {
        const definition = read.tables.eventDefinitions.get(args.eventDefinitionId);
        if (definition === undefined) {
          return refuseQuery({
            code: UNKNOWN_SHOW,
            message: 'There is no such show',
            field: 'eventDefinitionId',
          });
        }
        if (definition.promotionId !== args.promotionId) {
          return refuseQuery({
            code: NOT_YOUR_SHOW,
            message: `${definition.name} isn't one of your shows`,
            field: 'eventDefinitionId',
          });
        }
      }
      if (args.dealId !== undefined) {
        const deal = read.tables.deals.get(args.dealId);
        if (deal === undefined || deal.promotionId !== args.promotionId) {
          return refuseQuery({
            code: UNKNOWN_DEAL,
            message: 'There is no such deal of yours',
            field: 'dealId',
          });
        }
      }
      return dealValuation(read, ctx.tunables, {
        promotionId: args.promotionId,
        networkId: args.networkId,
        eventDefinitionId: args.eventDefinitionId,
        timeslot: args.timeslot,
        live: args.live,
        months: args.months,
        excludeDealId: args.dealId ?? null,
      });
    },
  },
);

export const publicDealsQuery: QueryDefinition<'broadcast.publicDeals'> = defineQuery(
  'broadcast.publicDeals',
  {
    args: z.strictObject({ promotionId: zId('promotion') }),
    run: (ctx, args) => {
      const { read } = ctx;
      if (read.tables.promotions.get(args.promotionId) === undefined) {
        return refuseQuery({
          code: UNKNOWN_PROMOTION,
          message: 'There is no such promotion',
          field: 'promotionId',
        });
      }
      const today = read.meta.currentDate;
      const rows: PublicDealRow[] = [];
      for (const deal of read.tables.deals.lookup('byPromotion', args.promotionId)) {
        const network = read.tables.networks.get(deal.networkId);
        if (network === undefined || !dealIsLive(deal, today)) {
          continue;
        }
        // Listed field by field so a money field added to deals can never leak through here.
        rows.push({
          dealId: deal.id,
          networkName: network.name,
          kind: network.kind,
          showName: dealShowName(read, deal, network),
          weekday: deal.weekday,
          timeslot: deal.timeslot,
          live: deal.live,
          startsOn: deal.startsOn,
          endsOn: deal.endsOn,
        });
      }
      return rows;
    },
  },
);

/** Every broadcast query, for the system bundle. */
export const broadcastQueries = [networksQuery, valuationQuery, publicDealsQuery] as const;
