/**
 * Storyline segments: the promotion's active stories get a place on the card before the filler.
 *
 * - Which: active storylines of the show's promotion whose brand is none or the show's, with heat
 *   at least `aip.card.storylineMinHeat`, hottest first (then storyline ID), at most
 *   `aip.card.maxStorylineSegments`.
 * - What: when a face and a heel of the story can both wrestle tonight, a roll of
 *   `aip.card.storylineMatchChance` (on the `aip.card` stream) decides a match: singles, or tag
 *   when each side has two free members. Otherwise a talking segment with the free members who can
 *   talk (injured members who can still do talking segments included).
 * - Room: a match needs a free match slot and a talking segment a free talking slot. When the one
 *   wanted is full the other is tried; with neither the story is skipped: "No room on the card
 *   tonight".
 *
 * Every draft carries `storylineIds: [storylineId]`, so the story shield (D-09) and storyline heat
 * apply to rival cards too.
 *
 * Design: docs/design/rival-booking.md#storylines.
 */

import type { PersonId } from '../../../core/ids';
import { rollChance } from '../../../core/rng/rolls';
import type { RngStream } from '../../../core/rng/registry';
import { matchTypesOf } from '../../../model/catalogs';
import type { Gender } from '../../../model/entities/person';
import type { Storyline } from '../../../model/entities/storyline';
import { compareIds } from '../../../model/table';
import type { GameWorldView } from '../../../model/tables';
import type { DeepReadonly } from '../../../model/world';
import type { EngineTunables } from '../../tunables';
import { formatNumber } from '../../world/people/labels';
import { isFreeToWrestle, seatRulesFor, type CardBook } from './fallback';
import { firstTypeOfFamily, matchSegment } from './matchDraft';
import { BookerNotes } from './notes';
import { buildTalkSegment } from './talk';
import { STORYLINES_DOC_REF } from './tunables';
import type { CardCandidate, CardPool, PlannedSegment, PlannedSide } from './types';

export const NO_ROOM_REASON = 'No room on the card tonight';
export const NOBODY_FREE_REASON = 'Nobody in the story is free tonight';

/** "Storyline: Ise vs Kuroe (heat 64)". */
export function storylineNote(name: string, heat: number): string {
  return `Storyline: ${name} (heat ${formatNumber(heat)})`;
}

export interface StorylineDeps {
  readonly read: GameWorldView;
  readonly tunables: EngineTunables;
  readonly rng: RngStream;
}

/** The storylines that may get a segment tonight, in booking order. */
export function storylinesForShow(
  read: GameWorldView,
  pool: CardPool,
  tunables: EngineTunables,
): DeepReadonly<Storyline>[] {
  const minHeat = tunables.get('aip.card.storylineMinHeat');
  const most = tunables.get('aip.card.maxStorylineSegments');
  return read.tables.storylines
    .lookup('byPromotion', pool.promotionId)
    .filter(
      (storyline) =>
        storyline.status === 'active' &&
        (storyline.brandId === null || storyline.brandId === pool.brandId) &&
        storyline.heat >= minHeat,
    )
    .sort((left, right) => right.heat - left.heat || compareIds(left.id, right.id))
    .slice(0, most);
}

/** Room left on the card, counted down as segments are planned. */
export interface CardRoom {
  matches: number;
  talks: number;
}

/** The story's free wrestlers on `side`, in the pool's order (best card value first). */
function freeWrestlers(
  pool: CardPool,
  storyline: DeepReadonly<Storyline>,
  side: 'face' | 'heel',
  book: CardBook,
  tunables: EngineTunables,
): CardCandidate[] {
  const members = new Set<PersonId>(
    storyline.members.filter((member) => member.side === side).map((member) => member.personId),
  );
  const rules = seatRulesFor(tunables, book);
  return pool.candidates.filter(
    (candidate) =>
      members.has(candidate.personId) &&
      candidate.restedEnough &&
      isFreeToWrestle(candidate, rules, null),
  );
}

interface StoryMatchup {
  readonly faces: readonly CardCandidate[];
  readonly heels: readonly CardCandidate[];
}

/**
 * The face and heel sides of a story match: one each, or two each for a tag match. Without mixed
 * matches, both sides share the best free face's gender that has a heel to meet.
 */
function storyMatchup(
  faces: readonly CardCandidate[],
  heels: readonly CardCandidate[],
  mixedGender: boolean,
): StoryMatchup | null {
  const genders: (Gender | null)[] = mixedGender
    ? [null]
    : [...new Set(faces.map((face) => face.gender))];
  for (const gender of genders) {
    const sameFaces = faces.filter((face) => gender === null || face.gender === gender);
    const sameHeels = heels.filter((heel) => gender === null || heel.gender === gender);
    if (sameFaces.length === 0 || sameHeels.length === 0) {
      continue;
    }
    const size = sameFaces.length >= 2 && sameHeels.length >= 2 ? 2 : 1;
    return { faces: sameFaces.slice(0, size), heels: sameHeels.slice(0, size) };
  }
  return null;
}

/** The pool team made of exactly `members`, if there is one. */
function teamOf(pool: CardPool, members: readonly CardCandidate[]): PlannedSide['teamId'] {
  if (members.length < 2) {
    return null;
  }
  const ids = new Set<string>(members.map((member) => member.personId));
  return (
    pool.teams.find(
      (team) =>
        team.memberIds.length === members.length &&
        team.memberIds.every((memberId) => ids.has(memberId)),
    )?.teamId ?? null
  );
}

export type StorylineOutcome =
  { readonly segment: PlannedSegment } | { readonly skipped: string; readonly trace: string };

/**
 * One storyline's segment tonight, or the reason it is skipped. Books its people into `book` and
 * takes its slot from `room`.
 */
export function planStorylineSegment(
  pool: CardPool,
  storyline: DeepReadonly<Storyline>,
  state: { readonly book: CardBook; readonly room: CardRoom },
  deps: StorylineDeps,
): StorylineOutcome {
  const { read, tunables, rng } = deps;
  const { book, room } = state;
  const key = `storyline:${storyline.id}`;
  const notes = new BookerNotes().note(storylineNote(storyline.name, storyline.heat));
  const faces = freeWrestlers(pool, storyline, 'face', book, tunables);
  const heels = freeWrestlers(pool, storyline, 'heel', book, tunables);
  const matchup = storyMatchup(faces, heels, tunables.get('aip.card.mixedGender'));
  notes.rule('A face and a heel of the story can wrestle tonight', matchup !== null);

  let wantsMatch = false;
  if (matchup !== null) {
    const chance = tunables.get('aip.card.storylineMatchChance');
    const roll = rollChance(rng, chance, `A match for ${storyline.name}`);
    notes.roll(roll.roll);
    wantsMatch = roll.value;
  }

  const tryMatch = (): PlannedSegment | null => {
    if (matchup === null || room.matches <= 0) {
      return null;
    }
    const tag = matchup.faces.length === 2;
    const type = firstTypeOfFamily(matchTypesOf(read), tag ? 'tag' : 'oneOnOne');
    if (type === undefined) {
      return null;
    }
    const sides: PlannedSide[] = [matchup.faces, matchup.heels].map((members) => ({
      personIds: members.map((member) => member.personId),
      teamId: teamOf(pool, members),
      isChampions: false,
    }));
    notes.note(tag ? 'Two free on each side: a tag match' : 'Face against heel, one on one');
    room.matches -= 1;
    book.add(
      sides.flatMap((side) => side.personIds),
      true,
    );
    return matchSegment(pool, read, {
      key,
      source: 'storyline',
      type,
      sides,
      storylineIds: [storyline.id],
      notes,
      because: 'The story continues in the ring',
      docRef: STORYLINES_DOC_REF,
    });
  };

  const tryTalk = (): PlannedSegment | null => {
    if (room.talks <= 0) {
      return null;
    }
    const segment = buildTalkSegment(
      pool,
      {
        key,
        storylineId: storyline.id,
        alreadyBooked: book,
        sourceNote: storylineNote(storyline.name, storyline.heat),
      },
      deps,
    );
    if (segment === null) {
      return null;
    }
    room.talks -= 1;
    book.add(
      segment.draft.participants.map((participant) => participant.personId),
      false,
    );
    return segment;
  };

  const segment = wantsMatch ? (tryMatch() ?? tryTalk()) : (tryTalk() ?? tryMatch());
  if (segment !== null) {
    return { segment };
  }
  const anyoneFree =
    matchup !== null ||
    pool.candidates.some(
      (candidate) =>
        candidate.canTalk &&
        candidate.contractBlock === null &&
        (book.appearances.get(candidate.personId) ?? 0) === 0 &&
        storyline.members.some((member) => member.personId === candidate.personId),
    );
  const reason = anyoneFree ? NO_ROOM_REASON : NOBODY_FREE_REASON;
  return { skipped: reason, trace: `${storyline.name}: ${reason}` };
}
