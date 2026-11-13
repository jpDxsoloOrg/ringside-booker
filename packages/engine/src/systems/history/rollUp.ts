/**
 * `history.rollUp` (POL4-08): the save keeps the last `history.keepDetailDays` days of play in
 * detail and older play as totals.
 *
 * Weekly on Mondays in the `periodic` group (order 41, just after the aftermath prune at 40, so
 * the aftermath rows it keeps are this week's), for every promotion, the player's included:
 *
 * 1. **Shows.** Each completed show dated before the window gets a summary on its result
 *    (`result.history`): how many segments its card had, its main event in words, its box office
 *    totals and its worldwide popularity before and after. A show from a save made before POL4-08
 *    is summarised by its first roll-up.
 * 2. **Cards.** The segments and participants of summarised and cancelled shows before the window
 *    are deleted, except the matches `segmentsToKeep` names (title lineage, recent form, win
 *    streaks, the rival booker's title history), which stay until nothing reads them.
 * 3. **Popularity records.** The per-region show records (`popularityShowChanges`) of shows before
 *    the window are deleted; their worldwide figures are in the summaries.
 * 4. **Money.** Ledger rows dated before the window are added into their promotion's monthly
 *    totals (`ledgerMonths`) by category and deleted, so month totals, charts, the cash Why? and
 *    the year's profit and loss come out the same.
 *
 * Nothing current changes: popularity, momentum, money, records, contracts and reigns are read,
 * never written. Every pass runs in ID order, so a roll-up is deterministic.
 *
 * Design: docs/design/save-format.md#history-retention.
 */

import { compareDates, yearMonthOf, type GameDate, type YearMonth } from '../../core/date';
import type { EventInstanceId, PromotionId } from '../../core/ids';
import { cents } from '../../core/money';
import type { PhaseContext } from '../../core/pipeline/context';
import { definePhase, type PhaseDefinition } from '../../core/pipeline/phase';
import type { EventInstance, ShowHistory } from '../../model/entities/event-instance';
import {
  LEDGER_CATEGORIES,
  type LedgerCategory,
  type LedgerMonth,
} from '../../model/entities/ledger-entry';
import type { DeepReadonly } from '../../model/world';
import { boxOfficeRowsOf } from '../boxOffice/settlementQueries';
import { cardSegments } from '../booking/card';
import { showChangeOf } from '../promoPop/helpers';
import { mainEventSummaryOf } from '../shows/resultsView';
import { segmentsToKeep } from './keep';
import { detailKeptFrom } from './note';

export const HISTORY_ROLL_UP_PHASE_ID = 'history.rollUp';
/** Just after `match.pruneAftermaths` (40), before the rival prunes (42, 43). */
export const HISTORY_ROLL_UP_PHASE_ORDER = 41;

/** What one roll-up did, for the log and the tests. */
export interface RollUpCounts {
  shows: number;
  segments: number;
  participants: number;
  showChanges: number;
  ledgerRows: number;
}

function isBefore(date: GameDate, from: GameDate): boolean {
  return compareDates(date, from) < 0;
}

/** The summary a completed show keeps once its detail goes. */
export function showHistoryOf(
  ctx: Pick<PhaseContext, 'read'>,
  show: DeepReadonly<EventInstance>,
): ShowHistory {
  const record = showChangeOf(ctx.read, show.id);
  const boxOffice = boxOfficeRowsOf(ctx.read, show);
  return {
    segments: cardSegments(ctx.read, show.id).length,
    mainEvent: mainEventSummaryOf(ctx.read, show),
    boxOffice: {
      tickets: cents(boxOffice.tickets),
      venueRent: cents(boxOffice.venueRent),
      liveMerch: cents(boxOffice.liveMerch),
    },
    world: record === undefined ? null : { before: record.worldBefore, after: record.worldAfter },
  };
}

/** Step 1: summarises every completed show before `from` that has no summary yet. */
function summariseShows(ctx: PhaseContext, from: GameDate): number {
  let count = 0;
  for (const show of ctx.read.tables.eventInstances.lookup('byStatus', 'completed')) {
    const { result } = show;
    if (result === null || result.history !== undefined || !isBefore(show.date, from)) {
      continue;
    }
    const history = showHistoryOf(ctx, show);
    ctx.tx.update('eventInstances', show.id, (previous) =>
      previous.result === null
        ? previous
        : { ...previous, result: { ...previous.result, history } },
    );
    count += 1;
  }
  return count;
}

/** True when a show's card may go: summarised, or cancelled, and before `from`. */
function cardMayGo(show: DeepReadonly<EventInstance> | undefined, from: GameDate): boolean {
  if (show === undefined || !isBefore(show.date, from)) {
    return false;
  }
  return show.status === 'cancelled' || show.result?.history !== undefined;
}

/** Step 2: deletes the old segments nothing reads any more, with their participants. */
function pruneCards(
  ctx: PhaseContext,
  from: GameDate,
): Pick<RollUpCounts, 'segments' | 'participants'> {
  const { tables } = ctx.read;
  const shows = new Map<EventInstanceId, boolean>();
  const doomed = tables.segments.values().filter((segment) => {
    let mayGo = shows.get(segment.eventInstanceId);
    if (mayGo === undefined) {
      mayGo = cardMayGo(tables.eventInstances.get(segment.eventInstanceId), from);
      shows.set(segment.eventInstanceId, mayGo);
    }
    return mayGo;
  });
  if (doomed.length === 0) {
    return { segments: 0, participants: 0 };
  }
  const keep = segmentsToKeep(ctx.read, ctx.date, ctx.tunables);
  let segments = 0;
  let participants = 0;
  for (const segment of doomed) {
    if (keep.has(segment.id)) {
      continue;
    }
    for (const participant of tables.participants.lookup('bySegment', segment.id)) {
      ctx.tx.delete('participants', participant.id);
      participants += 1;
    }
    ctx.tx.delete('segments', segment.id);
    segments += 1;
  }
  return { segments, participants };
}

/** Step 3: deletes the per-region popularity records of shows before `from`. */
function pruneShowChanges(ctx: PhaseContext, from: GameDate): number {
  const stale = ctx.read.tables.popularityShowChanges
    .values()
    .filter((row) => isBefore(row.date, from))
    .map((row) => row.id);
  for (const id of stale) {
    ctx.tx.delete('popularityShowChanges', id);
  }
  return stale.length;
}

interface MonthTally {
  byCategory: Map<LedgerCategory, number>;
  rows: number;
  through: GameDate;
}

function mergeMonth(
  month: YearMonth,
  existing: DeepReadonly<LedgerMonth> | undefined,
  tally: MonthTally,
): LedgerMonth {
  const byCategory: LedgerMonth['byCategory'] = {};
  for (const category of LEDGER_CATEGORIES) {
    const total = (existing?.byCategory[category] ?? 0) + (tally.byCategory.get(category) ?? 0);
    if (total !== 0) {
      byCategory[category] = cents(total);
    }
  }
  const through =
    existing !== undefined && compareDates(existing.through, tally.through) > 0
      ? existing.through
      : tally.through;
  return { month, byCategory, rows: (existing?.rows ?? 0) + tally.rows, through };
}

/** Step 4: rolls the ledger rows before `from` into monthly totals and deletes them. */
function rollUpLedger(ctx: PhaseContext, from: GameDate): number {
  const tallies = new Map<PromotionId, Map<YearMonth, MonthTally>>();
  const rolled = ctx.read.tables.ledgerEntries.values().filter((row) => isBefore(row.date, from));
  for (const row of rolled) {
    const byMonth = tallies.get(row.promotionId) ?? new Map<YearMonth, MonthTally>();
    tallies.set(row.promotionId, byMonth);
    const month = yearMonthOf(row.date);
    const tally: MonthTally = byMonth.get(month) ?? {
      byCategory: new Map<LedgerCategory, number>(),
      rows: 0,
      through: row.date,
    };
    byMonth.set(month, tally);
    tally.byCategory.set(row.category, (tally.byCategory.get(row.category) ?? 0) + row.amount);
    tally.rows += 1;
    if (compareDates(row.date, tally.through) > 0) {
      tally.through = row.date;
    }
  }
  for (const [promotionId, byMonth] of [...tallies.entries()].sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  )) {
    ctx.tx.update('promotions', promotionId, (previous) => {
      const months = new Map<YearMonth, LedgerMonth>(
        previous.ledgerMonths.map((entry) => [entry.month, entry]),
      );
      for (const [month, tally] of byMonth) {
        months.set(month, mergeMonth(month, months.get(month), tally));
      }
      const ledgerMonths = [...months.values()].sort((left, right) =>
        left.month < right.month ? -1 : left.month > right.month ? 1 : 0,
      );
      return { ...previous, ledgerMonths };
    });
  }
  for (const row of rolled) {
    ctx.tx.delete('ledgerEntries', row.id);
  }
  return rolled.length;
}

/** Runs the four steps for `today`; returns what each did. */
export function rollUpHistory(ctx: PhaseContext): RollUpCounts {
  const from = detailKeptFrom(ctx.date, ctx.tunables.get('history.keepDetailDays'));
  const shows = summariseShows(ctx, from);
  const cards = pruneCards(ctx, from);
  const showChanges = pruneShowChanges(ctx, from);
  const ledgerRows = rollUpLedger(ctx, from);
  return { shows, ...cards, showChanges, ledgerRows };
}

export const historyRollUpPhase: PhaseDefinition = definePhase({
  id: HISTORY_ROLL_UP_PHASE_ID,
  group: 'periodic',
  order: HISTORY_ROLL_UP_PHASE_ORDER,
  cadence: { kind: 'weekly', weekday: 'mon' },
  run: (ctx) => {
    const counts = rollUpHistory(ctx);
    if (counts.shows + counts.segments + counts.showChanges + counts.ledgerRows > 0) {
      ctx.log(
        `history: summarised ${String(counts.shows)} show(s); removed ${String(counts.segments)} segment(s), ${String(counts.participants)} participant(s), ${String(counts.showChanges)} popularity record(s); rolled ${String(counts.ledgerRows)} ledger row(s) into monthly totals`,
      );
    }
  },
});
