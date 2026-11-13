/**
 * The fallback chain: who fills one place (a "seat") in a match when the roster is thin.
 *
 * `findWorker(pool, seat, rules, level)` returns the candidates a seat may take at one level, best
 * card value first. The planner tries levels 1 to 4 and stops at the first that finds anyone; each
 * level tried is a rule line in the segment's trace.
 *
 * Never relaxed, at any level: the worker can wrestle tonight (available, a wrestler), has no
 * contract block (appearance cap used up, no house shows), is not already in a match on this card
 * (or in this match), is under `booking.maxAppearancesPerShow`, and is the match's gender unless
 * `aip.card.mixedGender` is on.
 *
 * 1. rested (fatigue at most `aip.card.maxFatigue`), the opposite alignment to the other side where
 *    one is set, not in an active team (one-on-one matches only), among the top
 *    `aip.card.pickWindow` free workers by card value;
 * 2. any alignment, team members too, still among the top `aip.card.pickWindow`;
 * 3. anyone free on the roster;
 * 4. tired workers too (still available), as a last resort.
 *
 * The window is taken after the fixed rules, never before, so a filter can never empty a window
 * that had someone fit just below it.
 *
 * Design: docs/design/rival-booking.md#fallback-chain.
 */

import type { PersonId } from '../../../core/ids';
import { rollWeighted } from '../../../core/rng/rolls';
import type { RngStream } from '../../../core/rng/registry';
import type { Alignment } from '../../../model/entities/employment';
import type { Gender } from '../../../model/entities/person';
import type { EngineTunables } from '../../tunables';
import { formatNumber } from '../../world/people/labels';
import type { BookerNotes } from './notes';
import type { CardCandidate, CardPool } from './types';

export const FALLBACK_LEVELS = [1, 2, 3, 4] as const;
export type FallbackLevel = (typeof FALLBACK_LEVELS)[number];

/** Who is on tonight's card so far. */
export interface CardBookings {
  /** Everyone in a match tonight. */
  readonly inMatch: ReadonlySet<PersonId>;
  /** Segments of any kind each person is in tonight. */
  readonly appearances: ReadonlyMap<PersonId, number>;
}

/** The bookings as the planner keeps them while it fills the card. */
export class CardBook implements CardBookings {
  readonly inMatch = new Set<PersonId>();
  readonly appearances = new Map<PersonId, number>();

  /** A book that starts with `bookings` (the player's own picks), or empty. */
  static from(bookings?: CardBookings): CardBook {
    const book = new CardBook();
    for (const personId of bookings?.inMatch ?? []) {
      book.inMatch.add(personId);
    }
    for (const [personId, count] of bookings?.appearances ?? []) {
      book.appearances.set(personId, count);
    }
    return book;
  }

  /** Books `personIds` into one segment; `match` marks them as wrestling tonight. */
  add(personIds: readonly PersonId[], match: boolean): void {
    for (const personId of personIds) {
      if (match) {
        this.inMatch.add(personId);
      }
      this.appearances.set(personId, (this.appearances.get(personId) ?? 0) + 1);
    }
  }
}

/** The place to fill. */
export interface Seat {
  /** The match's gender, or null for its first seat (which sets it). */
  readonly gender: Gender | null;
  /** The other side's alignment, when one is set; the seat prefers the opposite. */
  readonly otherAlignment: Alignment | null;
  /** True in a one-on-one match: level 1 prefers workers outside any team. */
  readonly singles: boolean;
}

/** The fixed rules for this card and match. */
export interface SeatRules {
  readonly bookings: CardBookings;
  /** People already seated in this match. */
  readonly seated: ReadonlySet<PersonId>;
  /** `booking.maxAppearancesPerShow`. */
  readonly maxAppearances: number;
  /** `aip.card.mixedGender`. */
  readonly mixedGender: boolean;
  /** `aip.card.pickWindow`. */
  readonly pickWindow: number;
}

/** The fixed seat rules read from the tunables. */
export function seatRulesFor(
  tunables: EngineTunables,
  bookings: CardBookings,
  seated: ReadonlySet<PersonId> = new Set(),
): SeatRules {
  return {
    bookings,
    seated,
    maxAppearances: tunables.get('booking.maxAppearancesPerShow'),
    mixedGender: tunables.get('aip.card.mixedGender'),
    pickWindow: tunables.get('aip.card.pickWindow'),
  };
}

/** "Level 1: rested, opposite alignment, outside a team, among the top 5 free". */
export function levelText(level: FallbackLevel, window: number): string {
  switch (level) {
    case 1:
      return `Level 1: rested, opposite alignment, outside a team, among the top ${String(window)} free`;
    case 2:
      return `Level 2: any alignment or team, among the top ${String(window)} free`;
    case 3:
      return 'Level 3: anyone free on the roster';
    case 4:
      return 'Level 4: tired workers allowed as a last resort';
  }
}

/** "#1 Haruto Ise (71), #2 Daichi Kuroe (65)". */
export function rankedText(candidates: readonly CardCandidate[]): string {
  return candidates
    .map(
      (candidate, index) =>
        `#${String(index + 1)} ${candidate.ringName} (${formatNumber(candidate.cardValue.value)})`,
    )
    .join(', ');
}

function opposite(alignment: Alignment | null): Alignment | null {
  if (alignment === 'face') {
    return 'heel';
  }
  return alignment === 'heel' ? 'face' : null;
}

/** The never-relaxed rules: can wrestle, no contract block, free tonight, the match's gender. */
export function isFreeToWrestle(
  candidate: CardCandidate,
  rules: SeatRules,
  gender: Gender | null,
): boolean {
  return (
    candidate.canWrestle &&
    candidate.contractBlock === null &&
    !rules.bookings.inMatch.has(candidate.personId) &&
    !rules.seated.has(candidate.personId) &&
    (rules.bookings.appearances.get(candidate.personId) ?? 0) < rules.maxAppearances &&
    (gender === null || rules.mixedGender || candidate.gender === gender)
  );
}

/**
 * The candidates `seat` may take at `level`, best card value first (the pool's order); empty when
 * nobody fits. See the module comment for the levels.
 */
export function findWorker(
  pool: CardPool,
  seat: Seat,
  rules: SeatRules,
  level: FallbackLevel,
): CardCandidate[] {
  const free = pool.candidates.filter(
    (candidate) =>
      isFreeToWrestle(candidate, rules, seat.gender) && (level === 4 || candidate.restedEnough),
  );
  if (level >= 3) {
    return free;
  }
  const window = free.slice(0, rules.pickWindow);
  if (level === 2) {
    return window;
  }
  const wanted = opposite(seat.otherAlignment);
  return window.filter(
    (candidate) =>
      (wanted === null || candidate.alignment === wanted) &&
      (!seat.singles || candidate.teamIds.length === 0),
  );
}

/**
 * Fills `seat`: levels 1 to 4 until one finds anyone, then a roll weighted by card value (at least
 * 1) among them. Writes each level tried, the ranked candidates and the roll into `notes`. Null
 * when no level finds anyone.
 */
export function seatWorker(
  pool: CardPool,
  seat: Seat,
  rules: SeatRules,
  deps: { readonly rng: RngStream },
  notes: BookerNotes,
  seatLabel: string,
): CardCandidate | null {
  for (const level of FALLBACK_LEVELS) {
    const found = findWorker(pool, seat, rules, level);
    notes.rule(`${seatLabel}: ${levelText(level, rules.pickWindow)}`, found.length > 0);
    if (found.length === 0) {
      continue;
    }
    notes.note(`${seatLabel}: ${rankedText(found.slice(0, Math.max(rules.pickWindow, 1)))}`);
    const [only] = found;
    if (found.length === 1 && only !== undefined) {
      return only;
    }
    const roll = rollWeighted(
      deps.rng,
      found.map((candidate) => ({
        item: candidate,
        weight: Math.max(1, candidate.cardValue.value),
      })),
      seatLabel,
      (candidate) => candidate.ringName,
    );
    notes.roll(roll.roll);
    return roll.value;
  }
  return null;
}
