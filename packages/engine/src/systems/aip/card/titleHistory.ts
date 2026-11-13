/**
 * A title's recent past, as the title picture reads it: when it was last defended and who
 * challenged for it lately.
 *
 * Only completed shows count. Before EVT3 completes title matches, `lastDefenceOf` falls back to the
 * open reign's start, so "days since the last defence" counts from the day the champion won.
 *
 * Design: docs/design/rival-booking.md#title-picture and #challengers.
 */

import { compareDates, type GameDate } from '../../../core/date';
import type { PersonId, TitleId } from '../../../core/ids';
import type { Segment } from '../../../model/entities/segment';
import { compareIds } from '../../../model/table';
import type { GameWorldView } from '../../../model/tables';
import type { DeepReadonly } from '../../../model/world';
import { openReignOf } from '../inputs';

/** When a title was last on the line, and where that date came from. */
export interface LastDefence {
  /** The date, or null for a vacant title that was never defended. */
  readonly date: GameDate | null;
  /** `match` for a completed title match, `reignStart` for the open reign's `wonOn`. */
  readonly source: 'match' | 'reignStart';
}

interface DatedSegment {
  readonly segment: DeepReadonly<Segment>;
  readonly date: GameDate;
}

/**
 * The title's matches on completed shows (held on or before `today` when given), newest first (then segment ID
 * descending, so two matches on one show keep a fixed order).
 */
function completedTitleMatches(
  read: GameWorldView,
  titleId: TitleId,
  today: GameDate | null,
): DatedSegment[] {
  const dated: DatedSegment[] = [];
  for (const segment of read.tables.segments.lookup('byTitle', titleId)) {
    const instance = read.tables.eventInstances.get(segment.eventInstanceId);
    if (
      instance?.status !== 'completed' ||
      (today !== null && compareDates(instance.date, today) > 0)
    ) {
      continue;
    }
    dated.push({ segment, date: instance.date });
  }
  return dated.sort(
    (left, right) =>
      compareDates(right.date, left.date) || compareIds(right.segment.id, left.segment.id),
  );
}

/**
 * The latest completed title match's date, else the open reign's `wonOn` (`source: 'reignStart'`),
 * else null (a vacant title with no completed match).
 */
export function lastDefenceOf(
  read: GameWorldView,
  title: { readonly titleId: TitleId },
  today: GameDate,
): LastDefence {
  const [latest] = completedTitleMatches(read, title.titleId, today);
  if (latest !== undefined) {
    return { date: latest.date, source: 'match' };
  }
  return { date: openReignOf(read, title.titleId)?.wonOn ?? null, source: 'reignStart' };
}

/**
 * Up to `count` distinct people who challenged for the title in its latest completed matches, newest
 * first: competitors who did not hold the title going into the match (a reign won before the
 * match's date and not lost before it). A vacant title's match has only challengers.
 */
export function recentChallengersOf(
  read: GameWorldView,
  titleId: TitleId,
  count: number,
): PersonId[] {
  if (count <= 0) {
    return [];
  }
  const reigns = read.tables.titleReigns.lookup('byTitle', titleId);
  const holdersOn = (date: GameDate): Set<string> =>
    new Set(
      reigns
        .filter(
          (reign) =>
            compareDates(reign.wonOn, date) < 0 &&
            (reign.lostOn === null || compareDates(reign.lostOn, date) >= 0),
        )
        .flatMap((reign) => reign.holderIds),
    );
  const challengers: PersonId[] = [];
  for (const { segment, date } of completedTitleMatches(read, titleId, null)) {
    const holders = holdersOn(date);
    const competitors = read.tables.participants
      .lookup('bySegment', segment.id)
      .filter((row) => row.role === 'competitor' && !holders.has(row.personId))
      .sort((left, right) => left.side - right.side || compareIds(left.id, right.id));
    for (const row of competitors) {
      if (!challengers.includes(row.personId)) {
        challengers.push(row.personId);
      }
      if (challengers.length >= count) {
        return challengers;
      }
    }
  }
  return challengers;
}
