/**
 * What a settled show drew and took (EVT6-05), for the results page's Box office section.
 *
 * - `boxOffice.showCrowd`: any show's crowd and venue. Public: rival shows' crowds were seen by
 *   everyone in the building.
 * - `boxOffice.showMoney`: one show's ticket price, gate, rent, merch, workers' shares and net.
 *   Only for the viewer's own shows (and the omniscient viewer of tools and tests): other
 *   promotions' takings are private.
 *
 * The amounts come from the show's result and its three box office ledger rows, so they match the
 * ledger and the Show money section exactly, even once the Why? traces are no longer kept. Every
 * trace ref is passed through `traces.has`: an evicted trace gives null, never a Why? that opens
 * nothing. Design: docs/design/box-office.md#settlement.
 */

import { z } from 'zod';
import { viewerPromotionIds, type Viewer } from '../../core/api/controller';
import { defineQuery, type QueryDefinition, type TraceReader } from '../../core/api/query';
import { INVALID_ARGS, refuseQuery } from '../../core/api/result';
import { yearMonthOf } from '../../core/date';
import type { EventInstanceId } from '../../core/ids';
import { cents, type Cents } from '../../core/money';
import type { TraceRef } from '../../core/trace/store';
import type { EventInstance } from '../../model/entities/event-instance';
import { ledgerMonthKey } from '../../model/entities/ledger-entry';
import { zId } from '../../model/primitives';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';
import type { VenueSummary } from './api';
import { BOX_OFFICE_CATEGORIES, type BoxOfficeCategory } from './settle';
import { showVenueOf } from './showVenue';
import { settlementTraceRef, type SettlementTraceKind } from './traceKinds';
import { summaryOf } from './venueChoice';

/** Where a show is in its box office life. */
export const SHOW_CROWD_STATUSES = ['settled', 'notSettled', 'notRun'] as const;
export type ShowCrowdStatus = (typeof SHOW_CROWD_STATUSES)[number];

/** `boxOffice.showCrowd`: how many came to a show. */
export interface ShowCrowd {
  /** `settled` once the crowd is in; `notSettled` for a show that ran but was not settled; `notRun` otherwise. */
  status: ShowCrowdStatus;
  venue: VenueSummary | null;
  /** People in the building, or null until settled. */
  attendance: number | null;
  /** The venue's capacity, or null while the show has no venue. */
  capacity: number | null;
  /** How full the venue was, 0 to 100, rounded to a whole percent; null until settled. */
  percentFull: number | null;
  /** Why the crowd was that size, or null when the trace is not kept. */
  attendanceTraceRef: TraceRef | null;
}

/** One amount of a show's box office, with its Why?. */
export interface BoxOfficeAmount {
  amount: Cents;
  traceRef: TraceRef | null;
}

/** `boxOffice.showMoney`: what one of the viewer's shows took. Costs are negative. */
export interface ShowMoney {
  ticketPrice: BoxOfficeAmount;
  /** Ticket sales before the workers' share. */
  grossGate: BoxOfficeAmount;
  gateShare: BoxOfficeAmount;
  /** Ticket money kept: the Tickets ledger row. */
  tickets: BoxOfficeAmount;
  /** The rent, negative: the Venue rent ledger row. */
  venueRent: BoxOfficeAmount;
  grossMerch: BoxOfficeAmount;
  merchShare: BoxOfficeAmount;
  /** Merch money kept: the Live merch ledger row. */
  liveMerch: BoxOfficeAmount;
  /** The three rows added up. */
  net: BoxOfficeAmount;
}

declare module '../../core/api/maps' {
  interface QueryMap {
    'boxOffice.showCrowd': {
      args: { eventInstanceId: EventInstanceId };
      result: ShowCrowd;
    };
    'boxOffice.showMoney': {
      args: { eventInstanceId: EventInstanceId };
      result: ShowMoney;
    };
  }
}

export const PRIVATE_MONEY_MESSAGE = "Other promotions' takings are private";
export const NOT_SETTLED_MESSAGE = 'Box office not settled yet';
const SHOW_NOT_FOUND_MESSAGE = 'That show no longer exists';

type Show = DeepReadonly<EventInstance>;

function showOrRefuse(read: GameWorldView, eventInstanceId: EventInstanceId): Show {
  const show = read.tables.eventInstances.get(eventInstanceId);
  if (show === undefined) {
    return refuseQuery({
      code: INVALID_ARGS,
      message: SHOW_NOT_FOUND_MESSAGE,
      field: 'eventInstanceId',
    });
  }
  return show;
}

function keptRef(
  traces: Pick<TraceReader, 'has'>,
  kind: SettlementTraceKind,
  eventInstanceId: EventInstanceId,
): TraceRef | null {
  const ref = settlementTraceRef(kind, eventInstanceId);
  return traces.has(ref) ? ref : null;
}

/** Whether the viewer may see the show's money: their own promotion's, or the omniscient viewer. */
export function seesShowMoney(
  read: GameWorldView,
  show: DeepReadonly<Pick<EventInstance, 'promotionId'>>,
  viewer: DeepReadonly<Viewer>,
): boolean {
  return (
    viewer.kind === 'omniscient' || viewerPromotionIds(read, viewer).includes(show.promotionId)
  );
}

/**
 * The show's box office ledger rows added up by category. A line that posted nothing is 0. Once
 * the show's history is rolled up (POL4-08) its rows are gone and the totals its summary kept are
 * returned instead.
 */
export function boxOfficeRowsOf(
  read: GameWorldView,
  show: DeepReadonly<Pick<EventInstance, 'id' | 'promotionId' | 'date' | 'result'>>,
): Record<BoxOfficeCategory, number> {
  const kept = show.result?.history?.boxOffice;
  if (kept !== undefined) {
    return { tickets: kept.tickets, venueRent: kept.venueRent, liveMerch: kept.liveMerch };
  }
  const totals: Record<BoxOfficeCategory, number> = { tickets: 0, venueRent: 0, liveMerch: 0 };
  const rows = read.tables.ledgerEntries.lookup(
    'byPromotionMonth',
    ledgerMonthKey(show.promotionId, yearMonthOf(show.date)),
  );
  for (const row of rows) {
    if (row.refs.eventInstanceId !== show.id) {
      continue;
    }
    for (const category of BOX_OFFICE_CATEGORIES) {
      if (row.category === category) {
        totals[category] += row.amount;
      }
    }
  }
  return totals;
}

/** `boxOffice.showCrowd`: any show's crowd, venue and capacity. */
export const showCrowdQuery: QueryDefinition<'boxOffice.showCrowd'> = defineQuery(
  'boxOffice.showCrowd',
  {
    args: z.strictObject({ eventInstanceId: zId('eventInstance') }),
    run: (ctx, args) => {
      const show = showOrRefuse(ctx.read, args.eventInstanceId);
      const venue = showVenueOf(ctx.read, show);
      const capacity = venue?.capacity ?? null;
      const attendance = show.result?.attendance ?? null;
      const status: ShowCrowdStatus =
        show.status !== 'completed' ? 'notRun' : attendance === null ? 'notSettled' : 'settled';
      return {
        status,
        venue: venue === null ? null : summaryOf(ctx.read, venue),
        attendance,
        capacity,
        percentFull:
          attendance === null || capacity === null || capacity <= 0
            ? null
            : Math.round((attendance / capacity) * 100),
        attendanceTraceRef:
          attendance === null
            ? null
            : (keptRef(ctx.traces, 'boxOffice.attendance', show.id) ??
              keptRef(ctx.traces, 'boxOffice.rivalAttendance', show.id)),
      };
    },
  },
);

/** `boxOffice.showMoney`: one of the viewer's settled shows, line by line. */
export const showMoneyQuery: QueryDefinition<'boxOffice.showMoney'> = defineQuery(
  'boxOffice.showMoney',
  {
    args: z.strictObject({ eventInstanceId: zId('eventInstance') }),
    run: (ctx, args) => {
      const show = showOrRefuse(ctx.read, args.eventInstanceId);
      const subject = { kind: 'eventInstance', id: show.id } as const;
      if (!seesShowMoney(ctx.read, show, ctx.viewer)) {
        return refuseQuery({
          code: 'boxOffice.privateMoney',
          message: PRIVATE_MONEY_MESSAGE,
          subject,
        });
      }
      const result = show.result;
      if (result?.attendance == null || result.gate === null) {
        return refuseQuery({ code: 'boxOffice.notSettled', message: NOT_SETTLED_MESSAGE, subject });
      }
      const rows = boxOfficeRowsOf(ctx.read, show);
      const grossGate = result.gate;
      const grossMerch = result.merch ?? rows.liveMerch;
      const ticketPrice =
        result.ticketPrice ??
        (result.attendance > 0 ? Math.round(grossGate / result.attendance) : 0);
      const ref = (kind: SettlementTraceKind): TraceRef | null =>
        keptRef(ctx.traces, kind, show.id);
      const line = (amount: number, kind: SettlementTraceKind): BoxOfficeAmount => ({
        amount: cents(amount),
        traceRef: ref(kind),
      });
      return {
        ticketPrice: line(ticketPrice, 'boxOffice.ticketPrice'),
        grossGate: line(grossGate, 'boxOffice.gate'),
        gateShare: line(grossGate - rows.tickets, 'boxOffice.gate'),
        tickets: line(rows.tickets, 'boxOffice.gate'),
        venueRent: line(rows.venueRent, 'boxOffice.venueRent'),
        grossMerch: line(grossMerch, 'boxOffice.liveMerch'),
        merchShare: line(grossMerch - rows.liveMerch, 'boxOffice.liveMerch'),
        liveMerch: line(rows.liveMerch, 'boxOffice.liveMerch'),
        net: line(rows.tickets + rows.venueRent + rows.liveMerch, 'boxOffice.net'),
      };
    },
  },
);

export const settlementQueries: readonly QueryDefinition[] = [showCrowdQuery, showMoneyQuery];
