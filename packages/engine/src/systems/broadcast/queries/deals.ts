/**
 * The player's deals (ECO8-05): `broadcast.deals` lists them with their health, `broadcast.deal`
 * shows one with its full airing history, and `broadcast.cancelPreview` shows what walking away
 * would cost before the player confirms.
 *
 * Visibility: a deal's money, viewers and health belong to its promotion. `broadcast.deals` and
 * `broadcast.cancelPreview` are for the viewer's own promotions only; `broadcast.deal` on a rival's
 * deal returns only what `broadcast.publicDeals` shows.
 *
 * Design: docs/design/broadcast.md#queries-and-visibility.
 */

import { z } from 'zod';
import { viewerPromotionIds } from '../../../core/api/controller';
import { defineQuery, type QueryDefinition } from '../../../core/api/query';
import { refuseQuery } from '../../../core/api/result';
import { diffDays, type GameDate, type Weekday } from '../../../core/date';
import type { DealId, EventDefinitionId, NetworkId, PromotionId } from '../../../core/ids';
import type { TraceNode, Traced } from '../../../core/trace';
import type { TraceRef } from '../../../core/trace/store';
import type { AiringStatus } from '../../../model/entities/airing';
import type {
  Deal,
  DealEndReason,
  DealStatus,
  DealTerms,
  DealTimeslot,
} from '../../../model/entities/deal';
import type { Network, NetworkKind } from '../../../model/entities/network';
import { compareIds } from '../../../model/table';
import { zId, type ImageRef } from '../../../model/primitives';
import type { GameWorldView } from '../../../model/tables';
import type { EngineTunables } from '../../tunables';
import { benchmarkFor } from '../audienceInputs';
import { exitFeeFor } from '../commands/cancelDeal';
import { DEAL_NOT_ACTIVE } from '../commands/shared';
import type { DealRisk } from '../events';
import { audienceNoun, dealTargets, type DealTargets } from '../formulas/ratingsBonus';
import { airingsNewestFirst, dealHealthOf, upcomingMissedAirings } from '../health';
import { dealHealthTraceRef } from '../traces';
import { dealShowName, promotionWideImportance } from '../valuation';
import { AIRINGS_MAX_LIMIT, airingRowOf, type AiringRow } from './airings';
import { publicDealRow, requireOwnPromotion, UNKNOWN_DEAL, type PublicDealRow } from './networks';

/** One recent airing, for a Sparkline. */
export interface DealRecentAiring {
  airDate: GameDate;
  viewers: number;
  expectedViewers: number;
  status: AiringStatus;
}

/** One of the promotion's deals, with its health. Money in whole cents. */
export interface DealRow {
  dealId: DealId;
  networkId: NetworkId;
  networkName: string;
  kind: NetworkKind;
  logoRef: ImageRef;
  /** The show's name, or "All major shows" / "All televised shows" for a promotion-wide deal. */
  showName: string;
  eventDefinitionId: EventDefinitionId | null;
  weekday: Weekday | null;
  timeslot: DealTimeslot;
  live: boolean;
  terms: DealTerms;
  startsOn: GameDate;
  endsOn: GameDate;
  /** Days until `endsOn` (0 once reached). */
  daysLeft: number;
  status: DealStatus;
  endedReason: DealEndReason | null;
  /** The newest airing that aired, or null. */
  lastAiring: {
    airDate: GameDate;
    viewers: number;
    expectedViewers: number;
    traceRef: TraceRef | null;
  } | null;
  /** What the network expects a show in this slot to draw today, with its Why?; null for a house show. */
  expectedViewers: Traced<number> | null;
  /**
   * The lines the deal is judged by, in viewers (ECO8-10): stay safe, may cancel, ratings bonus,
   * each with its Why?; null once ended or for a house show.
   */
  targets: DealTargets | null;
  /** The newest airings (up to the health window), oldest first for a Sparkline. */
  recent: DealRecentAiring[];
  /** How the network sees the deal today; null once it has ended. */
  risk: DealRisk | null;
  /** Every reason behind the risk, worst first; empty once ended. */
  riskReasons: string[];
  /** Where the latest stored verdict is (after an airing, or the signing note), or null. */
  healthTraceRef: TraceRef | null;
  /** Shows the deal should air that are already cancelled, soonest first. */
  upcomingMissed: GameDate[];
}

/** One deal and its whole airing history (newest first). */
export interface DealDetail extends DealRow {
  airings: AiringRow[];
}

/** `broadcast.deal`: the whole deal for its own promotion, the public fields for anyone else. */
export type DealView =
  { visibility: 'own'; deal: DealDetail } | { visibility: 'public'; deal: PublicDealRow };

/** What walking away from a deal would cost. */
export interface CancelPreview {
  dealId: DealId;
  networkName: string;
  /** In whole cents (0 or more). */
  exitFee: number;
  trace: TraceNode;
}

declare module '../../../core/api/maps' {
  interface QueryMap {
    'broadcast.deals': {
      args: { promotionId: PromotionId; include: 'active' | 'all' };
      result: DealRow[];
    };
    'broadcast.deal': { args: { dealId: DealId }; result: DealView };
    'broadcast.cancelPreview': { args: { dealId: DealId }; result: CancelPreview };
  }
}

function expectedOf(
  read: GameWorldView,
  tunables: EngineTunables,
  deal: Deal,
  network: Network,
): Traced<number> | null {
  const definition =
    deal.eventDefinitionId === null
      ? undefined
      : read.tables.eventDefinitions.get(deal.eventDefinitionId);
  const importance =
    definition?.importance ?? promotionWideImportance(read, deal.promotionId, network);
  if (importance === 'house') {
    return null;
  }
  return benchmarkFor(read, tunables, {
    networkId: network.id,
    timeslot: deal.timeslot,
    importance,
  });
}

function dealRow(
  read: GameWorldView,
  tunables: EngineTunables,
  hasTrace: (ref: TraceRef) => boolean,
  deal: Deal,
  network: Network,
): DealRow {
  const today = read.meta.currentDate;
  const airings = airingsNewestFirst(read, deal.id);
  const last = airings.find((airing) => airing.status === 'aired');
  const running = deal.status === 'active';
  const health = running ? dealHealthOf(read, tunables, deal, network, today) : null;
  const healthRef = dealHealthTraceRef(deal.id);
  const expected = running ? expectedOf(read, tunables, deal, network) : null;
  return {
    dealId: deal.id,
    networkId: network.id,
    networkName: network.name,
    kind: network.kind,
    logoRef: network.logoRef,
    showName: dealShowName(read, deal, network),
    eventDefinitionId: deal.eventDefinitionId,
    weekday: deal.weekday,
    timeslot: deal.timeslot,
    live: deal.live,
    terms: { ...deal.terms },
    startsOn: deal.startsOn,
    endsOn: deal.endsOn,
    daysLeft: Math.max(0, diffDays(today, deal.endsOn)),
    status: deal.status,
    endedReason: deal.endedReason,
    lastAiring:
      last === undefined
        ? null
        : {
            airDate: last.airDate,
            viewers: last.viewers,
            expectedViewers: last.expectedViewers,
            traceRef: last.traceRef,
          },
    expectedViewers: expected,
    targets:
      expected === null
        ? null
        : dealTargets(
            expected,
            { networkName: network.name, noun: audienceNoun(network.kind) },
            { tunables },
          ),
    recent: airings
      .slice(0, tunables.get('broadcast.health.window'))
      .reverse()
      .map((airing) => ({
        airDate: airing.airDate,
        viewers: airing.viewers,
        expectedViewers: airing.expectedViewers,
        status: airing.status,
      })),
    risk: health?.value ?? null,
    riskReasons: health === null ? [] : [...health.reasons],
    healthTraceRef: hasTrace(healthRef) ? healthRef : null,
    upcomingMissed: running ? upcomingMissedAirings(read, deal, network, today) : [],
  };
}

export const dealsQuery: QueryDefinition<'broadcast.deals'> = defineQuery('broadcast.deals', {
  args: z.strictObject({
    promotionId: zId('promotion'),
    include: z.enum(['active', 'all']),
  }),
  run: (ctx, args) => {
    const { read } = ctx;
    requireOwnPromotion(read, ctx.viewer, args.promotionId);
    const hasTrace = (ref: TraceRef): boolean => ctx.traces.has(ref);
    const rows: DealRow[] = [];
    const deals = [...read.tables.deals.lookup('byPromotion', args.promotionId)].sort(
      (left, right) => compareIds(left.id, right.id),
    );
    for (const deal of deals) {
      const network = read.tables.networks.get(deal.networkId);
      if (network === undefined || (args.include === 'active' && deal.status !== 'active')) {
        continue;
      }
      rows.push(dealRow(read, ctx.tunables, hasTrace, deal, network));
    }
    return rows;
  },
});

export const dealQuery: QueryDefinition<'broadcast.deal'> = defineQuery('broadcast.deal', {
  args: z.strictObject({ dealId: zId('deal') }),
  run: (ctx, args) => {
    const { read } = ctx;
    const deal = read.tables.deals.get(args.dealId);
    const network = deal === undefined ? undefined : read.tables.networks.get(deal.networkId);
    if (deal === undefined || network === undefined) {
      return refuseQuery({ code: UNKNOWN_DEAL, message: 'There is no such deal', field: 'dealId' });
    }
    const own =
      ctx.viewer.kind === 'omniscient' ||
      viewerPromotionIds(read, ctx.viewer).includes(deal.promotionId);
    if (!own) {
      return { visibility: 'public', deal: publicDealRow(read, deal, network) };
    }
    const row = dealRow(read, ctx.tunables, (ref) => ctx.traces.has(ref), deal, network);
    const airings = airingsNewestFirst(read, deal.id)
      .slice(0, AIRINGS_MAX_LIMIT)
      .map((airing) => airingRowOf(read, airing, true));
    return { visibility: 'own', deal: { ...row, airings } };
  },
});

export const cancelPreviewQuery: QueryDefinition<'broadcast.cancelPreview'> = defineQuery(
  'broadcast.cancelPreview',
  {
    args: z.strictObject({ dealId: zId('deal') }),
    run: (ctx, args) => {
      const { read } = ctx;
      const deal = read.tables.deals.get(args.dealId);
      const network = deal === undefined ? undefined : read.tables.networks.get(deal.networkId);
      if (deal === undefined || network === undefined) {
        return refuseQuery({
          code: UNKNOWN_DEAL,
          message: 'There is no such deal',
          field: 'dealId',
        });
      }
      requireOwnPromotion(read, ctx.viewer, deal.promotionId);
      if (deal.status !== 'active') {
        return refuseQuery({
          code: DEAL_NOT_ACTIVE,
          message: 'This deal is no longer running',
          subject: { kind: 'deal', id: deal.id },
        });
      }
      const fee = exitFeeFor(read, ctx.tunables, deal);
      return { dealId: deal.id, networkName: network.name, exitFee: fee.value, trace: fee.trace };
    },
  },
);

/** Every deals query, for the system bundle. */
export const dealQueries = [dealsQuery, dealQuery, cancelPreviewQuery] as const;
