/**
 * A title's records: the longest and shortest reigns, the most defences, the most reigns and most
 * combined days per person, and the oldest and youngest champions. Pure: it reads only what it is
 * given, so the lineage screen and tests compute the same numbers.
 *
 * Ties go to the reign that came first (`compareReignsChronologically`: earliest `wonOn`, then
 * same-day reigns in the order they happened), then the lowest ID (a reign's ID for reign records, a person's
 * ID for person records, whose `wonOn` is their first reign of the title).
 *
 * Design: docs/design/titles.md#records.
 */

import { compareDates, diffDays, isAfter, isBefore, type GameDate } from '../../core/date';
import type { PersonId, TitleReignId } from '../../core/ids';
import { compareIds } from '../../model/table';
import { ageOn } from '../workers/helpers/age';
import { startCalc } from '../../core/trace/calc';
import type { Traced } from '../../core/trace/types';
import { reignDateText, reignDays } from './formulas/reignDays';
import { compareReignsChronologically } from './helpers/reignOrder';
import type { ReignEndReason } from '../../model/entities/title-reign';

/** What the records need to know about one reign. */
export interface TitleRecordReign {
  readonly id: TitleReignId;
  readonly holderIds: readonly PersonId[];
  /** How the lineage names the reign (`reignLabel`). */
  readonly label: string;
  readonly wonOn: GameDate;
  /** Null while the reign is current. */
  readonly lostOn: GameDate | null;
  /** How it ended, for the order of reigns that started on the same day (null while current). */
  readonly endReason?: ReignEndReason | null;
  readonly defences: number;
}

/** What the records need to know about one champion. */
export interface TitleRecordPerson {
  readonly birthDate: GameDate;
  /** The name a person record shows. */
  readonly ringName: string;
}

/** One record: its number, who set it, and the reigns it counts. */
export interface TitleRecord {
  value: number;
  /** The reign's label for a reign record, the person's ring name for a person record. */
  label: string;
  personIds: PersonId[];
  reignIds: TitleReignId[];
}

export interface TitleRecords {
  /** Days, current reign included (counted to today). */
  longestReign: TitleRecord | null;
  /** Days, finished reigns only. */
  shortestReign: TitleRecord | null;
  /** Defences in one reign. */
  mostDefences: TitleRecord | null;
  /** Reigns per person; each holder of a tag or trios reign counts it. */
  mostReigns: TitleRecord | null;
  /** Days held per person, over all their reigns. */
  mostCombinedDays: TitleRecord | null;
  /** Age in whole years on the day they won. */
  oldestChampion: TitleRecord | null;
  youngestChampion: TitleRecord | null;
}

const compareReigns = compareReignsChronologically;

function daysOf(reign: TitleRecordReign, today: GameDate): number {
  return reignDays({ wonOn: reign.wonOn, lostOn: reign.lostOn, today }).value;
}

/**
 * The best candidate: the highest `score` (use a negative score for "lowest wins"), ties to the
 * one that sorts first under `tieOrder`.
 */
function best<T>(
  candidates: readonly T[],
  score: (candidate: T) => number,
  tieOrder: (left: T, right: T) => number,
): T | null {
  let winner: T | null = null;
  let winnerScore = 0;
  for (const candidate of candidates) {
    const candidateScore = score(candidate);
    if (
      winner === null ||
      candidateScore > winnerScore ||
      (candidateScore === winnerScore && tieOrder(candidate, winner) < 0)
    ) {
      winner = candidate;
      winnerScore = candidateScore;
    }
  }
  return winner;
}

function reignRecord(reign: TitleRecordReign | null, value: number): TitleRecord | null {
  return reign === null
    ? null
    : { value, label: reign.label, personIds: [...reign.holderIds], reignIds: [reign.id] };
}

interface PersonTotals {
  readonly personId: PersonId;
  readonly firstWonOn: GameDate;
  readonly reigns: TitleRecordReign[];
  days: number;
}

interface ChampionAge {
  readonly personId: PersonId;
  readonly reign: TitleRecordReign;
  readonly age: number;
}

/** Every record for one title's reigns, as of `today`. */
export function titleRecords(
  reigns: readonly TitleRecordReign[],
  peopleById: ReadonlyMap<PersonId, TitleRecordPerson>,
  today: GameDate,
): TitleRecords {
  const chronological = [...reigns].sort(compareReigns);
  const finished = chronological.filter((reign) => reign.lostOn !== null);

  const longest = best(chronological, (reign) => daysOf(reign, today), compareReigns);
  const shortest = best(finished, (reign) => -daysOf(reign, today), compareReigns);
  const mostDefences = best(chronological, (reign) => reign.defences, compareReigns);

  const totals = new Map<PersonId, PersonTotals>();
  const ages: ChampionAge[] = [];
  for (const reign of chronological) {
    const days = daysOf(reign, today);
    for (const personId of reign.holderIds) {
      const entry = totals.get(personId) ?? {
        personId,
        firstWonOn: reign.wonOn,
        reigns: [],
        days: 0,
      };
      entry.reigns.push(reign);
      entry.days += days;
      totals.set(personId, entry);
      const person = peopleById.get(personId);
      if (person !== undefined) {
        ages.push({ personId, reign, age: ageOn(person, reign.wonOn) });
      }
    }
  }
  const people = [...totals.values()];
  const comparePeople = (left: PersonTotals, right: PersonTotals): number =>
    compareDates(left.firstWonOn, right.firstWonOn) || compareIds(left.personId, right.personId);
  const compareAges = (left: ChampionAge, right: ChampionAge): number =>
    compareReigns(left.reign, right.reign) || compareIds(left.personId, right.personId);

  const personRecord = (entry: PersonTotals | null, value: number): TitleRecord | null =>
    entry === null
      ? null
      : {
          value,
          label: peopleById.get(entry.personId)?.ringName ?? entry.personId,
          personIds: [entry.personId],
          reignIds: entry.reigns.map((reign) => reign.id),
        };
  const ageRecord = (entry: ChampionAge | null): TitleRecord | null =>
    entry === null
      ? null
      : {
          value: entry.age,
          label: peopleById.get(entry.personId)?.ringName ?? entry.personId,
          personIds: [entry.personId],
          reignIds: [entry.reign.id],
        };

  const mostReigns = best(people, (entry) => entry.reigns.length, comparePeople);
  const mostDays = best(people, (entry) => entry.days, comparePeople);
  const oldest = best(ages, (entry) => entry.age, compareAges);
  const youngest = best(ages, (entry) => -entry.age, compareAges);

  return {
    longestReign: reignRecord(longest, longest === null ? 0 : daysOf(longest, today)),
    shortestReign: reignRecord(shortest, shortest === null ? 0 : daysOf(shortest, today)),
    mostDefences: reignRecord(mostDefences, mostDefences?.defences ?? 0),
    mostReigns: personRecord(mostReigns, mostReigns?.reigns.length ?? 0),
    mostCombinedDays: personRecord(mostDays, mostDays?.days ?? 0),
    oldestChampion: ageRecord(oldest),
    youngestChampion: ageRecord(youngest),
  };
}

/**
 * Where the days-vacant count starts. The default world's titles were introduced long before the
 * reigns it lists, so counting from `introducedOn` would call decades of unrecorded history
 * "vacant". The count starts at the earlier of the first recorded reign and the game's start (the
 * game records every day from then on), but never before the title was introduced.
 */
export function vacancyCountStart(
  reigns: readonly Pick<TitleRecordReign, 'wonOn'>[],
  introducedOn: GameDate,
  gameStart: GameDate,
): GameDate {
  let recordedFrom = gameStart;
  for (const reign of reigns) {
    if (isBefore(reign.wonOn, recordedFrom)) {
      recordedFrom = reign.wonOn;
    }
  }
  return isAfter(recordedFrom, introducedOn) ? recordedFrom : introducedOn;
}

/** The covered and total days behind `daysVacant`. */
function vacancySpans(
  reigns: readonly Pick<TitleRecordReign, 'wonOn' | 'lostOn'>[],
  from: GameDate,
  until: GameDate,
): { total: number; covered: number } {
  if (!isAfter(until, from)) {
    return { total: 0, covered: 0 };
  }
  const spans = reigns
    .map((reign) => ({
      from: isBefore(reign.wonOn, from) ? from : reign.wonOn,
      to: reign.lostOn === null || isAfter(reign.lostOn, until) ? until : reign.lostOn,
    }))
    .filter((span) => isBefore(span.from, span.to))
    .sort((left, right) => compareDates(left.from, right.from));

  let covered = 0;
  let reach: GameDate = from;
  for (const span of spans) {
    const start = isAfter(span.from, reach) ? span.from : reach;
    if (isAfter(span.to, start)) {
      covered += diffDays(start, span.to);
      reach = span.to;
    }
  }
  return { total: diffDays(from, until), covered };
}

/**
 * Days from `from` up to (not including) `until` that no reign covers. Each reign covers `wonOn`
 * up to its `lostOn` (or `until` while current), the same way `reignDays` counts. Reigns that
 * started before `from` count only from `from`. Pass `vacancyCountStart(...)` as `from` so
 * unrecorded history before the first known reign is not counted.
 */
export function daysVacant(
  reigns: readonly Pick<TitleRecordReign, 'wonOn' | 'lostOn'>[],
  from: GameDate,
  until: GameDate,
): number {
  const { total, covered } = vacancySpans(reigns, from, until);
  return total - covered;
}

export const DAYS_VACANT_DOC_REF = 'docs/design/titles.md#records';

export interface DaysVacantInputs {
  readonly reigns: readonly Pick<TitleRecordReign, 'wonOn' | 'lostOn'>[];
  readonly introducedOn: GameDate;
  readonly gameStart: GameDate;
  /** Today, or the day the title was retired. */
  readonly until: GameDate;
  /** True when `until` is the retirement day. */
  readonly retired: boolean;
}

/** The plain-words note on where the count starts: "History before 4 Jan 1999 not recorded". */
export function historyNotRecordedText(from: GameDate): string {
  return `History before ${reignDateText(from)} not recorded`;
}

/**
 * `daysVacant` with its Why?: days since the count starts, less the days a reign covers. Says
 * where the count starts and, when that is after the title was introduced, that older history was
 * not recorded.
 */
export function explainDaysVacant(inputs: DaysVacantInputs): {
  value: Traced<number>;
  countedFrom: GameDate;
  historyRecordedFrom: GameDate | null;
} {
  const countedFrom = vacancyCountStart(inputs.reigns, inputs.introducedOn, inputs.gameStart);
  const { total, covered } = vacancySpans(inputs.reigns, countedFrom, inputs.until);
  const cutOff = isAfter(countedFrom, inputs.introducedOn);
  const endText = inputs.retired ? `its retirement on ${reignDateText(inputs.until)}` : 'today';
  let calc = startCalc('Days vacant', total, {
    unit: 'days',
    docRef: DAYS_VACANT_DOC_REF,
    startLabel: `Days from ${reignDateText(countedFrom)} to ${endText}`,
  }).subtract('Days with a champion', covered);
  if (cutOff) {
    const startsAtReign = inputs.reigns.some(
      (reign) => compareDates(reign.wonOn, countedFrom) === 0,
    );
    calc = calc.note(
      `${historyNotRecordedText(countedFrom)}: the count starts at ${
        startsAtReign ? 'the first known reign' : 'the start of the game'
      }, not when the title was introduced (${reignDateText(inputs.introducedOn)})`,
    );
  }
  return {
    value: calc.done(),
    countedFrom,
    historyRecordedFrom: cutOff ? countedFrom : null,
  };
}
