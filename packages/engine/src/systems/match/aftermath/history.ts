/**
 * A worker's earlier matches (MTCH3-02): what the popularity win-streak bonus and the Recent form
 * list read.
 *
 * "Prior" means strictly before the match being judged: an earlier date, or the same show and
 * earlier on its card (the pre-show before the main card, then a lower slot). The match being
 * judged is never in its own history, even when its result is already written, so a win is not
 * counted twice. Only matches that have been run count: a match with no result, or with only a
 * planned result on a show that has not happened, is not history. Only competitors count; a
 * manager at ringside did not win or lose.
 *
 * Design: docs/design/match-aftermath.md#prior-matches.
 */

import type { GameDate } from '../../../core/date';
import { compareDates } from '../../../core/date';
import { InvalidArgumentError } from '../../../core/errors';
import type { EventInstanceId, PersonId, SegmentId } from '../../../core/ids';
import type { MatchOutcome } from '../../../model/entities/segment';
import { compareIds } from '../../../model/table';
import type { GameWorldView } from '../../../model/tables';
import type { DeepReadonly } from '../../../model/world';

/** How one match went for one side. */
export type MatchResultForSide = 'win' | 'loss' | 'draw' | 'noContest';

/**
 * Where the match being judged sits. `eventInstanceId` is null for a match that is on no show (the
 * Match lab): then only earlier days count. `segmentId` is the match itself when it is stored, so
 * it is left out even if its date and slot would say otherwise.
 */
export interface MatchPosition {
  readonly date: GameDate;
  readonly eventInstanceId: EventInstanceId | null;
  readonly preShow: boolean;
  readonly slot: number;
  readonly segmentId: SegmentId | null;
}

/** One earlier match of one person, from that person's side. */
export interface PriorMatch {
  readonly segmentId: SegmentId;
  readonly eventInstanceId: EventInstanceId;
  readonly date: GameDate;
  readonly result: MatchResultForSide;
  /** The side the person was on. */
  readonly sideOf: number;
  /** The competitors on every other side, by id. */
  readonly opponentIds: readonly PersonId[];
}

/** A run of straight wins and the matches it is made of, newest first. */
export interface WinStreak {
  readonly streak: number;
  readonly segmentIds: readonly SegmentId[];
}

/**
 * How a match with a result went for `side`. Throws for a match with no result yet: callers
 * decide what an unplayed match means before asking.
 */
export function resultOf(
  segment: { readonly outcome: DeepReadonly<MatchOutcome> | null },
  side: number,
): MatchResultForSide {
  const { outcome } = segment;
  if (outcome === null) {
    throw new InvalidArgumentError('resultOf', 'segment.outcome', outcome, 'a match result');
  }
  switch (outcome.kind) {
    case 'win':
      return outcome.winningSide === side ? 'win' : 'loss';
    case 'draw':
      return 'draw';
    case 'noContest':
      return 'noContest';
  }
}

interface CardPlace {
  readonly date: GameDate;
  readonly eventInstanceId: EventInstanceId;
  readonly preShow: boolean;
  readonly slot: number;
}

/** Card order inside one show: the pre-show first, then by slot. Negative when `left` is earlier. */
function compareCardOrder(
  left: Pick<CardPlace, 'preShow' | 'slot'>,
  right: Pick<CardPlace, 'preShow' | 'slot'>,
): number {
  if (left.preShow !== right.preShow) {
    return left.preShow ? -1 : 1;
  }
  return left.slot - right.slot;
}

function isBeforePosition(place: CardPlace, before: MatchPosition): boolean {
  const byDate = compareDates(place.date, before.date);
  if (byDate !== 0) {
    return byDate < 0;
  }
  // Same day: only an earlier spot on the same show is known to come first.
  return (
    before.eventInstanceId !== null &&
    place.eventInstanceId === before.eventInstanceId &&
    compareCardOrder(place, before) < 0
  );
}

/** Newest first: later date, then later on the card; anything left is ordered by id. */
function newestFirst(left: PriorMatch & CardPlace, right: PriorMatch & CardPlace): number {
  const byDate = compareDates(right.date, left.date);
  if (byDate !== 0) {
    return byDate;
  }
  if (left.eventInstanceId === right.eventInstanceId) {
    const byCard = compareCardOrder(right, left);
    if (byCard !== 0) {
      return byCard;
    }
  }
  return compareIds(left.segmentId, right.segmentId);
}

function requireCount(functionName: string, argumentName: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new InvalidArgumentError(functionName, argumentName, value, 'a whole number, 0 or more');
  }
}

/**
 * The person's last `limit` matches as a competitor before `before`, newest first. Only matches
 * that were run and have a result count; `before.segmentId` is always left out.
 */
export function priorMatchesOf(
  read: GameWorldView,
  personId: PersonId,
  before: MatchPosition,
  limit: number,
): PriorMatch[] {
  requireCount('priorMatchesOf', 'limit', limit);
  if (limit === 0) {
    return [];
  }
  const { participants, segments, eventInstances } = read.tables;
  const found: (PriorMatch & CardPlace)[] = [];
  for (const entry of participants.lookup('byPerson', personId)) {
    if (entry.role !== 'competitor' || entry.segmentId === before.segmentId) {
      continue;
    }
    const segment = segments.get(entry.segmentId);
    // A rating is what marks a segment as run: before that, `outcome` is only the plan.
    if (segment?.kind !== 'match' || segment.outcome === null || segment.rating === null) {
      continue;
    }
    const instance = eventInstances.require(segment.eventInstanceId);
    const place: CardPlace = {
      date: instance.date,
      eventInstanceId: instance.id,
      preShow: segment.preShow,
      slot: segment.slot,
    };
    if (!isBeforePosition(place, before)) {
      continue;
    }
    const opponentIds = participants
      .lookup('bySegment', segment.id)
      .filter((other) => other.role === 'competitor' && other.side !== entry.side)
      .map((other) => other.personId)
      .sort(compareIds);
    found.push({
      ...place,
      segmentId: segment.id,
      result: resultOf(segment, entry.side),
      sideOf: entry.side,
      opponentIds,
    });
  }
  return found
    .sort(newestFirst)
    .slice(0, limit)
    .map(({ segmentId, eventInstanceId, date, result, sideOf, opponentIds }) => ({
      segmentId,
      eventInstanceId,
      date,
      result,
      sideOf,
      opponentIds,
    }));
}

/**
 * Straight wins going into `before`, looking back at most `lookback` matches
 * (`match.popularity.streakLookback`). A loss or a draw ends the streak; a no contest is skipped
 * (it neither ends nor extends it). The match being judged is never counted.
 */
export function winStreakBefore(
  read: GameWorldView,
  personId: PersonId,
  before: MatchPosition,
  lookback: number,
): WinStreak {
  requireCount('winStreakBefore', 'lookback', lookback);
  const segmentIds: SegmentId[] = [];
  for (const prior of priorMatchesOf(read, personId, before, lookback)) {
    if (prior.result === 'noContest') {
      continue;
    }
    if (prior.result !== 'win') {
      break;
    }
    segmentIds.push(prior.segmentId);
  }
  return { streak: segmentIds.length, segmentIds };
}
