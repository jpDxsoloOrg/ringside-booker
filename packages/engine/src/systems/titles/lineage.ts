/**
 * `titles.detail`: one title's card, its full lineage (newest first), its records and a few
 * totals. Lineage is kept forever: the history roll-up does not prune reigns.
 *
 * Design: docs/design/titles.md#queries and #records.
 */

import { compareDates, isBefore, type GameDate } from '../../core/date';
import type { PersonId, SegmentId, TeamId, TitleId, TitleReignId } from '../../core/ids';
import type { TraceRef } from '../../core/trace/store';
import type { TraceNode } from '../../core/trace/types';
import type { ReignEndReason, TitleReign } from '../../model/entities/title-reign';
import { compareIds } from '../../model/table';
import { reignDays } from './formulas/reignDays';
import { ringNameForTitle } from './helpers/employment';
import { reignLabel } from './helpers/holders';
import {
  explainDaysVacant,
  titleRecords,
  type TitleRecordPerson,
  type TitleRecordReign,
  type TitleRecords,
} from './records';
import { buildTitleCardRow, endReasonLabel, type TitleCardRow, type TitleRowContext } from './rows';

/** Where CRTV1-03 stores why a reign was vacated (keyed by reign). */
const TITLE_VACANCY_TRACE_KIND = 'titles.vacancy';

/** The reason code for a title that is not in the world. */
export const TITLE_NOT_FOUND = 'titleNotFound';
export const TITLE_NOT_FOUND_MESSAGE = "That title doesn't exist any more.";

/** One champion of a reign. */
export interface ReignHolderRow {
  personId: PersonId;
  /** The ring name they won it under. */
  nameAtTime: string;
  /** Their ring name with the title's promotion today. */
  currentRingName: string;
  imageRef: string | null;
}

/** One reign in the lineage. */
export interface ReignRow {
  reignId: TitleReignId;
  /** 1 = the first reign, counted in the order they were won. */
  number: number;
  holders: ReignHolderRow[];
  teamId: TeamId | null;
  label: string;
  wonOn: GameDate;
  lostOn: GameDate | null;
  daysHeld: number;
  /** How `daysHeld` was counted. */
  daysHeldTrace: TraceNode;
  defences: number;
  endReason: ReignEndReason | null;
  /** "Lost the title", "Vacated", ..., or "Current champion". */
  endReasonLabel: string;
  /** Why the reign was vacated, when CRTV1-03 stored it. */
  endTraceRef: TraceRef | null;
  /** Raw segment links; the results pages turn them into links when they exist. */
  wonInSegmentId: SegmentId | null;
  endedInSegmentId: SegmentId | null;
}

export interface TitleStats {
  totalReigns: number;
  /** Different people who have held it. */
  distinctChampions: number;
  /**
   * Days with no champion, up to today (or its retirement). Counted from the first recorded reign
   * or the game's start, whichever is earlier, but not before it was introduced (CRTV1-08).
   */
  daysVacant: number;
  /** How `daysVacant` was counted, for its Why?. */
  daysVacantTrace: TraceNode;
  /**
   * The day the count starts when it is later than `introducedOn`: older history was not recorded
   * ("History before 4 Jan 1999 not recorded"). Null when the count starts at the introduction.
   */
  historyRecordedFrom: GameDate | null;
}

export interface TitleDetail {
  title: TitleCardRow;
  /** Newest first: the current reign, then by `wonOn` descending, then ID descending. */
  reigns: ReignRow[];
  records: TitleRecords;
  stats: TitleStats;
}

function compareChronological(left: TitleReign, right: TitleReign): number {
  return compareDates(left.wonOn, right.wonOn) || compareIds(left.id, right.id);
}

/** `titles.detail`, or null when the title does not exist. */
export function titleDetailOf(ctx: TitleRowContext, titleId: TitleId): TitleDetail | null {
  const { read } = ctx;
  const title = read.tables.titles.get(titleId);
  if (title === undefined) {
    return null;
  }
  const today = read.meta.currentDate;
  const chronological = [...read.tables.titleReigns.lookup('byTitle', titleId)].sort(
    compareChronological,
  );

  const rows: ReignRow[] = chronological.map((reign, index) => {
    const days = reignDays({ wonOn: reign.wonOn, lostOn: reign.lostOn, today });
    const vacancyRef: TraceRef = { kind: TITLE_VACANCY_TRACE_KIND, id: reign.id };
    return {
      reignId: reign.id,
      number: index + 1,
      holders: reign.holderIds.map((personId, holderIndex) => ({
        personId,
        nameAtTime: reign.holderNamesAtTime[holderIndex] ?? personId,
        currentRingName: ringNameForTitle(read, personId, title.promotionId, today),
        imageRef: read.tables.people.get(personId)?.imageRef ?? null,
      })),
      teamId: reign.teamId,
      label: reignLabel(read, reign),
      wonOn: reign.wonOn,
      lostOn: reign.lostOn,
      daysHeld: days.value,
      daysHeldTrace: days.trace,
      defences: reign.defences,
      endReason: reign.endReason,
      endReasonLabel: endReasonLabel(reign, title),
      endTraceRef: ctx.traces.has(vacancyRef) ? vacancyRef : null,
      wonInSegmentId: reign.wonInSegmentId,
      endedInSegmentId: reign.endedInSegmentId,
    };
  });

  const recordReigns: TitleRecordReign[] = rows.map((row) => ({
    id: row.reignId,
    holderIds: row.holders.map((holder) => holder.personId),
    label: row.label,
    wonOn: row.wonOn,
    lostOn: row.lostOn,
    defences: row.defences,
  }));
  const peopleById = new Map<PersonId, TitleRecordPerson>();
  for (const row of rows) {
    for (const holder of row.holders) {
      const person = read.tables.people.get(holder.personId);
      if (person !== undefined && !peopleById.has(holder.personId)) {
        peopleById.set(holder.personId, {
          birthDate: person.birthDate,
          ringName: holder.currentRingName,
        });
      }
    }
  }

  const retiredBeforeToday = title.retiredOn !== null && isBefore(title.retiredOn, today);
  const vacantUntil = retiredBeforeToday && title.retiredOn !== null ? title.retiredOn : today;
  const vacant = explainDaysVacant({
    reigns: recordReigns,
    introducedOn: title.introducedOn,
    gameStart: read.meta.startDate,
    until: vacantUntil,
    retired: retiredBeforeToday,
  });
  const newestFirst = [...rows].sort(
    (left, right) =>
      compareDates(right.wonOn, left.wonOn) || compareIds(right.reignId, left.reignId),
  );
  // The open reign is the newest by construction (reigns never overlap), but keep it first even if
  // old data says otherwise.
  newestFirst.sort((left, right) => Number(right.lostOn === null) - Number(left.lostOn === null));

  return {
    title: buildTitleCardRow(ctx, title),
    reigns: newestFirst,
    records: titleRecords(recordReigns, peopleById, today),
    stats: {
      totalReigns: rows.length,
      distinctChampions: new Set(recordReigns.flatMap((reign) => reign.holderIds)).size,
      daysVacant: vacant.value.value,
      daysVacantTrace: vacant.value.trace,
      historyRecordedFrom: vacant.historyRecordedFrom,
    },
  };
}
