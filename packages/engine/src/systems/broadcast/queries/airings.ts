/**
 * What aired (ECO8-04): a promotion's airings (`broadcast.airings`), one show's airing for the
 * calendar sheet and the results page (`broadcast.showAiring`), and the player's broadcast money
 * over the last few weeks for the Finances page (`broadcast.incomeSummary`).
 *
 * Visibility: viewers are public for any promotion (ratings are news); money is shown only to the
 * promotion's controller (and the omniscient viewer), and is null for everyone else.
 *
 * Design: docs/design/broadcast.md#queries-and-visibility.
 */

import { z } from 'zod';
import { viewerPromotionIds, type Viewer } from '../../../core/api/controller';
import { defineQuery, type QueryDefinition } from '../../../core/api/query';
import { refuseQuery } from '../../../core/api/result';
import { addDays, compareDates, type GameDate } from '../../../core/date';
import type { AiringId, DealId, EventInstanceId, PromotionId } from '../../../core/ids';
import { startCalc, type TraceNode } from '../../../core/trace';
import type { TraceRef } from '../../../core/trace/store';
import type {
  Airing,
  AiringMissReason,
  AiringQualitySource,
  AiringStatus,
} from '../../../model/entities/airing';
import type { LedgerCategory } from '../../../model/entities/ledger-entry';
import type { NetworkKind } from '../../../model/entities/network';
import { zGameDate, zId } from '../../../model/primitives';
import type { GameWorldView } from '../../../model/tables';
import { detailKeptFrom, detailKeptNote } from '../../history/note';
import { AIRTIME_COST_CATEGORY, dealsAiringShow } from '../coverage';
import { AIRED_WITHOUT_RESULT_NOTE, AIRING_LOSS_NOTE, MISSED_AIRING_NOTES } from '../settle';
import { dealShowName } from '../valuation';
import { NOT_YOUR_PROMOTION, UNKNOWN_PROMOTION } from './networks';

export const UNKNOWN_SHOW_AIRING = 'unknownShow';
/** The longest period `broadcast.incomeSummary` adds up. */
export const INCOME_SUMMARY_MAX_DAYS = 365;
/** The most rows `broadcast.airings` returns. */
export const AIRINGS_MAX_LIMIT = 200;

/** The ledger categories broadcast money is posted under. */
export const BROADCAST_INCOME_CATEGORIES: readonly LedgerCategory[] = [
  'broadcast',
  'ppv',
  'streaming',
];

/** One airing as a list shows it. Money fields are null unless the viewer runs the promotion. */
export interface AiringRow {
  airingId: AiringId;
  airDate: GameDate;
  showName: string;
  eventInstanceId: EventInstanceId | null;
  dealId: DealId;
  networkName: string;
  status: AiringStatus;
  missReason: AiringMissReason | null;
  qualitySource: AiringQualitySource | null;
  viewers: number;
  expectedViewers: number;
  /** Gross the network paid, in cents. */
  income: number | null;
  /** The part of `income` paid on as workers' shares, in cents. */
  sharesPaid: number | null;
  /** Airtime charged, in cents. */
  cost: number | null;
  /** What the airing left the promotion with (income − shares − airtime), in cents. */
  net: number | null;
  traceRef: TraceRef | null;
  /** A plain line for the row: no show result, cancelled, or losing money; null when none. */
  note: string | null;
}

/** One show's airing, for the calendar sheet and the results page. */
export interface ShowAiringView {
  /** The deals that air (or aired) the show. */
  deals: { dealId: DealId; networkName: string; kind: NetworkKind }[];
  /** What happened, adding up every deal's airing; null until it airs. */
  airing: {
    status: AiringStatus;
    viewers: number;
    /** Gross paid, in cents; null unless the viewer runs the promotion. */
    income: number | null;
    note: string | null;
  } | null;
  /** True while the show is still to air on at least one deal. */
  upcoming: boolean;
}

/** The player's broadcast money over the last few weeks. */
export interface BroadcastIncomeSummary {
  /** Income less airtime, in cents. */
  total: number;
  /** One line per deal. */
  trace: TraceNode;
  /** The latest airing that aired, or null. */
  lastAiring: {
    showName: string;
    viewers: number;
    expectedViewers: number;
    airDate: GameDate;
  } | null;
  /** Set when the period reaches past the detail window, whose money is only in monthly totals. */
  note: string | null;
}

declare module '../../../core/api/maps' {
  interface QueryMap {
    'broadcast.airings': {
      args: {
        promotionId: PromotionId;
        dealId?: DealId | undefined;
        from?: GameDate | undefined;
        to?: GameDate | undefined;
        limit?: number | undefined;
      };
      result: AiringRow[];
    };
    'broadcast.showAiring': {
      args: { eventInstanceId: EventInstanceId };
      result: ShowAiringView;
    };
    'broadcast.incomeSummary': {
      args: { promotionId: PromotionId; days?: number | undefined };
      result: BroadcastIncomeSummary;
    };
  }
}

function seesMoney(read: GameWorldView, viewer: Viewer, promotionId: PromotionId): boolean {
  return viewer.kind === 'omniscient' || viewerPromotionIds(read, viewer).includes(promotionId);
}

function requirePromotion(read: GameWorldView, promotionId: PromotionId): void {
  if (read.tables.promotions.get(promotionId) === undefined) {
    refuseQuery({
      code: UNKNOWN_PROMOTION,
      message: 'There is no such promotion',
      field: 'promotionId',
    });
  }
}

/** The plain line for an airing: why it paid nothing, its stand-in quality, or its loss. */
function airingNote(airing: Airing, money: boolean): string | null {
  if (airing.missReason !== null) {
    return MISSED_AIRING_NOTES[airing.missReason];
  }
  if (airing.quality?.source === 'neutral') {
    return AIRED_WITHOUT_RESULT_NOTE;
  }
  if (money && airing.income - airing.sharesPaid - airing.cost < 0) {
    return AIRING_LOSS_NOTE;
  }
  return null;
}

function rowOf(read: GameWorldView, airing: Airing, money: boolean): AiringRow {
  return {
    airingId: airing.id,
    airDate: airing.airDate,
    showName: airing.showName,
    eventInstanceId: airing.eventInstanceId,
    dealId: airing.dealId,
    networkName: read.tables.networks.get(airing.networkId)?.name ?? '',
    status: airing.status,
    missReason: airing.missReason,
    qualitySource: airing.quality?.source ?? null,
    viewers: airing.viewers,
    expectedViewers: airing.expectedViewers,
    income: money ? airing.income : null,
    sharesPaid: money ? airing.sharesPaid : null,
    cost: money ? airing.cost : null,
    net: money ? airing.income - airing.sharesPaid - airing.cost : null,
    // The Why? holds the money too.
    traceRef: money ? airing.traceRef : null,
    note: airingNote(airing, money),
  };
}

/** Newest first: by air date, then id. */
function newestFirst(left: Airing, right: Airing): number {
  return compareDates(right.airDate, left.airDate) || (left.id < right.id ? 1 : -1);
}

export const airingsQuery: QueryDefinition<'broadcast.airings'> = defineQuery(
  'broadcast.airings',
  {
    args: z.strictObject({
      promotionId: zId('promotion'),
      dealId: zId('deal').optional(),
      from: zGameDate.optional(),
      to: zGameDate.optional(),
      limit: z.number().int().min(1).max(AIRINGS_MAX_LIMIT).optional(),
    }),
    run: (ctx, args) => {
      const { read } = ctx;
      requirePromotion(read, args.promotionId);
      const money = seesMoney(read, ctx.viewer, args.promotionId);
      const rows = (
        args.dealId === undefined
          ? read.tables.airings.lookup('byPromotion', args.promotionId)
          : read.tables.airings
              .lookup('byDeal', args.dealId)
              .filter((airing) => airing.promotionId === args.promotionId)
      ).filter(
        (airing) =>
          (args.from === undefined || compareDates(airing.airDate, args.from) >= 0) &&
          (args.to === undefined || compareDates(airing.airDate, args.to) <= 0),
      );
      return [...rows]
        .sort(newestFirst)
        .slice(0, args.limit ?? 50)
        .map((airing) => rowOf(read, airing, money));
    },
  },
);

export const showAiringQuery: QueryDefinition<'broadcast.showAiring'> = defineQuery(
  'broadcast.showAiring',
  {
    args: z.strictObject({ eventInstanceId: zId('eventInstance') }),
    run: (ctx, args) => {
      const { read } = ctx;
      const instance = read.tables.eventInstances.get(args.eventInstanceId);
      if (instance === undefined) {
        return refuseQuery({
          code: UNKNOWN_SHOW_AIRING,
          message: 'There is no such show',
          field: 'eventInstanceId',
        });
      }
      const money = seesMoney(read, ctx.viewer, instance.promotionId);
      const rows = [...read.tables.airings.lookup('byEventInstance', instance.id)].sort(
        (left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
      );
      const deals: ShowAiringView['deals'] = [];
      const seen = new Set<DealId>();
      const addDeal = (dealId: DealId): void => {
        const deal = read.tables.deals.get(dealId);
        const network = deal === undefined ? undefined : read.tables.networks.get(deal.networkId);
        if (network === undefined || seen.has(dealId)) {
          return;
        }
        seen.add(dealId);
        deals.push({ dealId, networkName: network.name, kind: network.kind });
      };
      for (const row of rows) {
        addDeal(row.dealId);
      }
      const today = read.meta.currentDate;
      const toAir =
        compareDates(instance.airDate, today) >= 0 && instance.status !== 'cancelled'
          ? dealsAiringShow(read, instance).filter((deal) => !seen.has(deal.id))
          : [];
      for (const deal of toAir) {
        addDeal(deal.id);
      }
      let airing: ShowAiringView['airing'] = null;
      const [first] = rows;
      if (first !== undefined) {
        const aired = rows.filter((row) => row.status === 'aired');
        const shown = aired[0] ?? first;
        airing = {
          status: aired.length > 0 ? 'aired' : 'missed',
          viewers: aired.reduce((sum, row) => sum + row.viewers, 0),
          income: money ? aired.reduce((sum, row) => sum + row.income, 0) : null,
          note: airingNote(shown, false),
        };
      }
      return { deals, airing, upcoming: toAir.length > 0 };
    },
  },
);

export const incomeSummaryQuery: QueryDefinition<'broadcast.incomeSummary'> = defineQuery(
  'broadcast.incomeSummary',
  {
    args: z.strictObject({
      promotionId: zId('promotion'),
      days: z.number().int().min(1).max(INCOME_SUMMARY_MAX_DAYS).optional(),
    }),
    run: (ctx, args) => {
      const { read } = ctx;
      requirePromotion(read, args.promotionId);
      if (!seesMoney(read, ctx.viewer, args.promotionId)) {
        return refuseQuery({
          code: NOT_YOUR_PROMOTION,
          message: 'You can only look at TV money for your own promotion',
          subject: { kind: 'promotion', id: args.promotionId },
        });
      }
      const days = args.days ?? 30;
      const today = read.meta.currentDate;
      // The last `days` days up to yesterday (today has not been played yet).
      const from = addDays(today, -days);
      const byDeal = new Map<DealId | null, number>();
      for (const row of read.tables.ledgerEntries.lookup('byPromotion', args.promotionId)) {
        const broadcast =
          BROADCAST_INCOME_CATEGORIES.includes(row.category) ||
          (row.category === AIRTIME_COST_CATEGORY && row.refs.dealId !== null);
        if (!broadcast || compareDates(row.date, from) < 0) {
          continue;
        }
        byDeal.set(row.refs.dealId, (byDeal.get(row.refs.dealId) ?? 0) + row.amount);
      }
      const calc = startCalc(`TV, pay-per-view and streaming money, last ${String(days)} days`, 0, {
        unit: 'money',
        docRef: 'broadcast.md#settlement',
        startLabel: 'Nothing yet',
      });
      const dealIds = [...byDeal.keys()].sort((left, right) =>
        left === right ? 0 : left === null ? 1 : right === null ? -1 : left < right ? -1 : 1,
      );
      for (const dealId of dealIds) {
        const amount = byDeal.get(dealId) ?? 0;
        calc.add(dealLabel(read, dealId), amount);
      }
      const keepDays = ctx.tunables.get('history.keepDetailDays');
      const reachesPastWindow = compareDates(from, detailKeptFrom(today, keepDays)) < 0;
      const note = reachesPastWindow
        ? `${detailKeptNote(ctx.tunables)} Older money is counted in the monthly totals.`
        : null;
      if (note !== null) {
        calc.note(note);
      }
      const total = calc.done();
      const last = [...read.tables.airings.lookup('byPromotion', args.promotionId)]
        .filter((airing) => airing.status === 'aired')
        .sort(newestFirst)[0];
      return {
        total: total.value,
        trace: total.trace,
        lastAiring:
          last === undefined
            ? null
            : {
                showName: last.showName,
                viewers: last.viewers,
                expectedViewers: last.expectedViewers,
                airDate: last.airDate,
              },
        note,
      };
    },
  },
);

/** "Mainstage on NSN" for a deal's line; "Other TV money" for rows without a deal. */
function dealLabel(read: GameWorldView, dealId: DealId | null): string {
  if (dealId === null) {
    return 'Other TV money';
  }
  const deal = read.tables.deals.get(dealId);
  const network = deal === undefined ? undefined : read.tables.networks.get(deal.networkId);
  if (deal === undefined || network === undefined) {
    return 'A deal no longer on file';
  }
  return `${dealShowName(read, deal, network)} on ${network.name}`;
}

/** Every airing query, for the system bundle. */
export const airingQueries = [airingsQuery, showAiringQuery, incomeSummaryQuery] as const;
