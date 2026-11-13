/**
 * Filling the card: everything a rival puts on tonight's card, as planned segments in no order yet
 * (AIP4-04 places them, AIP4-05 writes them).
 *
 * `fillCard(pool, { titles, matchSlots, talkSlots }, deps)` books, in this order:
 *
 * 1. the title matches already decided (`decideTitlePicture`), as they are;
 * 2. storyline segments (`storylineSegments.ts`), each taking a match or a talking slot;
 * 3. a filler match for every match slot left: the type is rolled with weights from
 *    `matchTypeWeight`, then each place is filled through the fallback chain (`fallback.ts`). Tag
 *    and trios sides take a free team first and pair workers only when no team fits. A type whose
 *    places cannot be filled steps down (trios to tag to one-on-one; multi-way and the rest to
 *    one-on-one); when even a one-on-one fails the slot becomes a talking segment if the card has
 *    room for one more, else it stays open: "Not enough free workers";
 * 4. a talking segment for every talking slot (`talk.ts`).
 *
 * Nobody is ever in two matches, over `booking.maxAppearancesPerShow`, unavailable or blocked by
 * their contract. Every segment carries its own decision with the booker's notes.
 *
 * Design: docs/design/rival-booking.md#filling-the-card.
 */

import type { PersonId, StorylineId } from '../../../core/ids';
import { rollWeighted } from '../../../core/rng/rolls';
import type { RngStream } from '../../../core/rng/registry';
import { startDecision, type Traced, type TraceNode } from '../../../core/trace';
import { matchTypesOf, type MatchTypeDef } from '../../../model/catalogs';
import type { Gender } from '../../../model/entities/person';
import { compareIds } from '../../../model/table';
import type { GameWorldView } from '../../../model/tables';
import type { EngineTunables } from '../../tunables';
import {
  CardBook,
  isFreeToWrestle,
  seatRulesFor,
  seatWorker,
  type CardBookings,
  type SeatRules,
} from './fallback';
import { talkRoomFor } from './formulas/cardShape';
import { familyPlaceOf, matchFamilyOf, matchTypeWeight } from './formulas/matchTypeWeight';
import { firstTypeOfFamily, matchSegment } from './matchDraft';
import { BookerNotes } from './notes';
import { planStorylineSegment, storylinesForShow, type CardRoom } from './storylineSegments';
import { buildTalkSegment, NO_TALKER_REASON } from './talk';
import { DEFEND_REASON } from './titlePicture';
import { FILLING_DOC_REF, TITLE_PICTURE_DOC_REF, type MatchFamily } from './tunables';
import type {
  CardFill,
  CardPool,
  CardTeam,
  OpenCardSlot,
  PlannedSegment,
  PlannedSide,
  PlannedTitleMatch,
  SkippedStoryline,
} from './types';

export const NOT_ENOUGH_WORKERS = 'Not enough free workers';
export const ALL_WEIGHTS_ZERO = 'Every match type weighs 0 tonight: a one-on-one match';
export const TALK_INSTEAD = 'No match could be filled: a talking segment instead';
export const FILLER_NOTE = 'Filler match: an open match slot';
export const TALK_SLOT_NOTE = 'Talking slot';
export const STORY_ON_CARD = "Already on tonight's card";

/** Where each family steps down to when its places cannot be filled. */
const STEP_DOWN: Readonly<Record<MatchFamily, MatchFamily | null>> = {
  trios: 'tag',
  tag: 'oneOnOne',
  multiWay: 'oneOnOne',
  other: 'oneOnOne',
  oneOnOne: null,
};

/** "Title match: the Test Title is on the line". */
export function titleMatchNote(titleName: string): string {
  return `Title match: the ${titleName} is on the line`;
}

/** "Could not fill Six-Person Tag: stepping down to Tag Team". */
export function stepDownText(from: string, to: string): string {
  return `Could not fill ${from}: stepping down to ${to}`;
}

/** "Three-Way needs 3, leaving too few for the 2 matches still to book". */
export function reserveText(typeName: string, needed: number, later: number): string {
  return `${typeName} needs ${String(needed)}, leaving too few for the ${String(later)} ${later === 1 ? 'match' : 'matches'} still to book`;
}

export interface FillCardArgs {
  /** Tonight's title matches, in booking order (`decideTitlePicture(...).planned`). */
  readonly titles: readonly PlannedTitleMatch[];
  /** Main-card slots for matches, title matches included. */
  readonly matchSlots: number;
  /** Main-card slots for talking segments (`talkSlotsFor`). */
  readonly talkSlots: number;
  /**
   * The most talking segments the card may hold, for a match slot that turns into one. Defaults to
   * `talkRoomFor(matchSlots + talkSlots, importance)`: no two talking segments in a row.
   */
  readonly talkRoom?: number;
  /** People already on the card before the planner starts (the player's own picks). */
  readonly alreadyBooked?: CardBookings;
  /** Storylines that already have a segment on the card (keep-filled mode); they get no other. */
  readonly storylinesOnCard?: ReadonlySet<StorylineId>;
}

export interface FillCardDeps {
  readonly read: GameWorldView;
  readonly tunables: EngineTunables;
  /** The `aip.card` stream for a rival show, `aip.autofill` for the player's Auto-fill. */
  readonly rng: RngStream;
}

/** The size of each side of a match of `type`: its fewest sides, one bigger last for a handicap. */
export function sidesOf(type: Pick<MatchTypeDef, 'sides' | 'sideSize' | 'equalSides'>): number[] {
  const sizes = Array.from({ length: type.sides.min }, () => type.sideSize.min);
  if (!type.equalSides && type.sideSize.max > type.sideSize.min && sizes.length > 0) {
    sizes[sizes.length - 1] = type.sideSize.min + 1;
  }
  return sizes;
}

/** A planned title match as a planned segment. */
export function titleSegmentOf(
  pool: CardPool,
  planned: PlannedTitleMatch,
  read: GameWorldView,
): PlannedSegment | null {
  const type = matchTypesOf(read, { includeHidden: true }).find(
    (entry) => entry.key === planned.matchTypeKey,
  );
  const title = pool.titles.find((entry) => entry.titleId === planned.titleId);
  if (type === undefined) {
    return null;
  }
  const notes = new BookerNotes()
    .note(titleMatchNote(title?.name ?? 'title'))
    .include('Why this title is on the line', planned.trace);
  return matchSegment(pool, read, {
    key: `title:${planned.titleId}`,
    source: 'title',
    type,
    sides: planned.sides,
    titleIds: [planned.titleId],
    notes,
    because: DEFEND_REASON,
    docRef: TITLE_PICTURE_DOC_REF,
  });
}

/** The pool's teams of `size` whose members are all free, rested and of one gender. */
function freeTeams(
  pool: CardPool,
  size: number,
  rules: SeatRules,
  gender: Gender | null,
): CardTeam[] {
  const kind = size === 3 ? 'trio' : 'tag';
  const byPerson = new Map(pool.candidates.map((candidate) => [candidate.personId, candidate]));
  return pool.teams
    .filter((team) => {
      if (team.kind !== kind || team.memberIds.length !== size) {
        return false;
      }
      const members = team.memberIds.map((memberId) => byPerson.get(memberId));
      const genders = new Set(members.map((member) => member?.gender));
      return (
        members.every(
          (member) =>
            member !== undefined && member.restedEnough && isFreeToWrestle(member, rules, gender),
        ) &&
        (rules.mixedGender || genders.size === 1)
      );
    })
    .sort(
      (left, right) =>
        right.meanCardValue - left.meanCardValue || compareIds(left.teamId, right.teamId),
    );
}

/** "#1 Test Team (64)". */
function teamsText(teams: readonly CardTeam[]): string {
  return teams
    .map(
      (team, index) =>
        `#${String(index + 1)} ${team.name} (${String(Math.round(team.meanCardValue))})`,
    )
    .join(', ');
}

/** A free team for a side, by a roll weighted by mean card value among the top of the window. */
function pickTeam(
  pool: CardPool,
  size: number,
  rules: SeatRules,
  gender: Gender | null,
  rng: RngStream,
  notes: BookerNotes,
  label: string,
): CardTeam | null {
  const window = freeTeams(pool, size, rules, gender).slice(0, rules.pickWindow);
  const [only] = window;
  if (only === undefined) {
    notes.note(`${label}: no free team, pairing workers for tonight`);
    return null;
  }
  notes.note(`${label}: ${teamsText(window)}`);
  if (window.length === 1) {
    return only;
  }
  const roll = rollWeighted(
    rng,
    window.map((team) => ({ item: team, weight: Math.max(1, team.meanCardValue) })),
    label,
    (team) => team.name,
  );
  notes.roll(roll.roll);
  return roll.value;
}

/** The sides of a match of `type`, or null when a place cannot be filled at any level. */
function seatMatch(
  pool: CardPool,
  type: MatchTypeDef,
  bookings: CardBookings,
  deps: FillCardDeps,
  notes: BookerNotes,
): PlannedSide[] | null {
  const sizes = sidesOf(type);
  const singles = matchFamilyOf(type) === 'oneOnOne';
  const seated = new Set<PersonId>();
  const rules = seatRulesFor(deps.tunables, bookings, seated);
  const byPerson = new Map(pool.candidates.map((candidate) => [candidate.personId, candidate]));
  let gender: Gender | null = null;
  const sides: PlannedSide[] = [];

  for (const [sideIndex, size] of sizes.entries()) {
    const sideLabel = `Side ${String(sideIndex + 1)}`;
    if (size >= 2 && size <= 3) {
      const team = pickTeam(pool, size, rules, gender, deps.rng, notes, sideLabel);
      if (team !== null) {
        for (const memberId of team.memberIds) {
          seated.add(memberId);
        }
        const [firstMember] = team.memberIds;
        if (gender === null && firstMember !== undefined) {
          gender = byPerson.get(firstMember)?.gender ?? null;
        }
        sides.push({ personIds: [...team.memberIds], teamId: team.teamId, isChampions: false });
        continue;
      }
    }
    const lead = sides[0]?.personIds[0];
    const otherAlignment =
      sizes.length === 2 && sideIndex === 1 && lead !== undefined
        ? (byPerson.get(lead)?.alignment ?? null)
        : null;
    const personIds: PersonId[] = [];
    for (let place = 0; place < size; place++) {
      const seatLabel = size === 1 ? sideLabel : `${sideLabel}, place ${String(place + 1)}`;
      const worker = seatWorker(
        pool,
        { gender, otherAlignment, singles },
        rules,
        deps,
        notes,
        seatLabel,
      );
      if (worker === null) {
        return null;
      }
      gender ??= worker.gender;
      seated.add(worker.personId);
      personIds.push(worker.personId);
    }
    sides.push({ personIds, teamId: null, isChampions: false });
  }
  return sides;
}

/** The match type of a filler slot: a roll weighted by `matchTypeWeight`. */
function rollMatchType(
  pool: CardPool,
  types: readonly MatchTypeDef[],
  later: number,
  bookings: CardBookings,
  deps: FillCardDeps,
  notes: BookerNotes,
): { type: MatchTypeDef; weight: Traced<number> | null } | null {
  const rules = seatRulesFor(deps.tunables, bookings);
  const free = pool.candidates.filter(
    (candidate) => candidate.restedEnough && isFreeToWrestle(candidate, rules, null),
  ).length;
  const reserve = 2 * later;
  const risk: Traced<number> = {
    value: pool.taste.values.riskAppetite,
    trace: pool.taste.traces.riskAppetite,
  };
  notes.note(`${String(free)} free wrestlers for this match`);

  const weighted: { type: MatchTypeDef; weight: Traced<number> }[] = [];
  const zero: string[] = [];
  for (const type of types) {
    const sizes = sidesOf(type);
    const needed = sizes.reduce((sum, size) => sum + size, 0);
    if (needed + reserve > free && needed <= free) {
      notes.rule(reserveText(type.name, needed, later), false);
      continue;
    }
    const size = sizes[0] ?? 1;
    const weight = matchTypeWeight(
      {
        typeName: type.name,
        family: matchFamilyOf(type),
        familyPlace: familyPlaceOf(type, types),
        peopleNeeded: needed,
        freeWrestlers: free,
        freeTeams: size >= 2 && size <= 3 ? freeTeams(pool, size, rules, null).length : 0,
        riskAppetite: risk,
      },
      deps,
    );
    if (weight.value <= 0) {
      zero.push(type.name);
      continue;
    }
    weighted.push({ type, weight });
  }
  if (zero.length > 0) {
    notes.note(`Left out at weight 0: ${zero.join(', ')}`);
  }

  if (weighted.length === 0) {
    const fallback = firstTypeOfFamily(types, 'oneOnOne');
    if (fallback === undefined) {
      return null;
    }
    notes.note(ALL_WEIGHTS_ZERO);
    return { type: fallback, weight: null };
  }
  for (const entry of weighted) {
    notes.consider(entry.type.name, entry.weight.value);
  }
  const roll = rollWeighted(
    deps.rng,
    weighted.map((entry) => ({ item: entry, weight: entry.weight.value })),
    'Match type',
    (entry) => entry.type.name,
  );
  notes.roll(roll.roll);
  return roll.value;
}

/**
 * A filler match of `type`, stepping down when its places cannot be filled. Books its people into
 * `book`. Null when even a one-on-one cannot be filled.
 */
export function bookMatchOfType(
  pool: CardPool,
  args: { readonly key: string; readonly type: MatchTypeDef; readonly book: CardBook },
  deps: FillCardDeps,
  notes: BookerNotes,
  because: string,
): PlannedSegment | null {
  const types = matchTypesOf(deps.read);
  let type: MatchTypeDef | undefined = args.type;
  while (type !== undefined) {
    const sides = seatMatch(pool, type, args.book, deps, notes);
    if (sides !== null) {
      args.book.add(
        sides.flatMap((side) => side.personIds),
        true,
      );
      return matchSegment(pool, deps.read, {
        key: args.key,
        source: 'filler',
        type,
        sides,
        notes,
        because: type === args.type ? because : stepDownText(args.type.name, type.name),
        docRef: FILLING_DOC_REF,
      });
    }
    let next: MatchFamily | null = STEP_DOWN[matchFamilyOf(type)];
    let nextType: MatchTypeDef | undefined;
    while (next !== null && nextType === undefined) {
      nextType = firstTypeOfFamily(types, next);
      next = nextType === undefined ? STEP_DOWN[next] : next;
    }
    if (nextType !== undefined) {
      notes.note(stepDownText(type.name, nextType.name));
    }
    type = nextType;
  }
  return null;
}

/**
 * Tonight's card, in no order yet. See the module comment for the steps. Read-only: it books into
 * its own bookkeeping and writes nothing.
 */
export function fillCard(pool: CardPool, args: FillCardArgs, deps: FillCardDeps): CardFill {
  const { read, tunables } = deps;
  const book = CardBook.from(args.alreadyBooked);

  const segments: PlannedSegment[] = [];
  const open: OpenCardSlot[] = [];
  const skippedStorylines: SkippedStoryline[] = [];
  const summary = startDecision<string>(`Filling the card for ${pool.showName}`, {
    docRef: FILLING_DOC_REF,
  });

  // 1. Title matches.
  for (const planned of args.titles) {
    const segment = titleSegmentOf(pool, planned, read);
    if (segment === null) {
      continue;
    }
    segments.push(segment);
    book.add(
      planned.sides.flatMap((side) => side.personIds),
      true,
    );
  }
  const room: CardRoom = {
    matches: Math.max(0, args.matchSlots - segments.length),
    talks: Math.max(0, args.talkSlots),
  };
  summary.note(
    `${String(args.matchSlots)} match slots (${String(segments.length)} title matches) and ${String(args.talkSlots)} talking slots`,
  );

  // 2. Storylines.
  for (const storyline of storylinesForShow(read, pool, tunables)) {
    if (args.storylinesOnCard?.has(storyline.id) === true) {
      skippedStorylines.push({ storylineId: storyline.id, reason: STORY_ON_CARD });
      summary.rule(`${storyline.name}: ${STORY_ON_CARD}`, false);
      continue;
    }
    const outcome = planStorylineSegment(pool, storyline, { book, room }, deps);
    if ('segment' in outcome) {
      segments.push(outcome.segment);
    } else {
      skippedStorylines.push({ storylineId: storyline.id, reason: outcome.skipped });
      summary.rule(outcome.trace, false);
    }
  }

  // 3. Filler matches.
  const talkRoom = args.talkRoom ?? talkRoomFor(args.matchSlots + args.talkSlots, pool.importance);
  let talksPlanned = args.talkSlots - room.talks;
  const types = matchTypesOf(read);
  const fillerSlots = room.matches;
  for (let index = 0; index < fillerSlots; index++) {
    const key = `filler:${String(index + 1)}`;
    const notes = new BookerNotes().note(FILLER_NOTE);
    const later = fillerSlots - index - 1;
    const rolled = rollMatchType(pool, types, later, book, deps, notes);
    const because =
      rolled?.weight === null ? ALL_WEIGHTS_ZERO : 'Picked by a roll weighted by match type weight';
    if (rolled !== null && rolled.weight !== null) {
      notes.include(`Weight of ${rolled.type.name}`, rolled.weight);
    }
    const segment =
      rolled === null
        ? null
        : bookMatchOfType(pool, { key, type: rolled.type, book }, deps, notes, because);
    if (segment !== null) {
      segments.push(segment);
      continue;
    }
    // The talking slots still to fill count too: they are planned below.
    if (talksPlanned + room.talks < talkRoom) {
      const talk = buildTalkSegment(
        pool,
        { key, alreadyBooked: book, sourceNote: TALK_INSTEAD },
        deps,
      );
      if (talk !== null) {
        talksPlanned += 1;
        book.add(
          talk.draft.participants.map((participant) => participant.personId),
          false,
        );
        segments.push(talk);
        continue;
      }
    }
    open.push({ key, kind: 'match', reason: NOT_ENOUGH_WORKERS });
  }

  // 4. Talking segments.
  const talkSlots = room.talks;
  for (let index = 0; index < talkSlots; index++) {
    const key = `talk:${String(index + 1)}`;
    const talk = buildTalkSegment(
      pool,
      { key, alreadyBooked: book, sourceNote: TALK_SLOT_NOTE },
      deps,
    );
    if (talk === null) {
      open.push({ key, kind: 'angle', reason: NO_TALKER_REASON });
      continue;
    }
    book.add(
      talk.draft.participants.map((participant) => participant.personId),
      false,
    );
    segments.push(talk);
  }

  for (const slot of open) {
    summary.rule(`${slot.key}: ${slot.reason}`, false);
  }
  const trace: TraceNode = summary.choose(
    String(segments.length),
    `${String(segments.length)} segments planned, ${String(open.length)} left open`,
  ).trace;
  return { segments, open, skippedStorylines, trace };
}
