/**
 * Talking segments: who talks tonight and in what kind of angle.
 *
 * `buildTalkSegment(pool, { key, storylineId?, alreadyBooked }, deps)` returns one planned angle,
 * or null when nobody can talk. MTCH5 will replace its single default beat through this function.
 *
 * - Speakers are people who can talk tonight (available, or out but able to do talking segments:
 *   "Injured, but can talk") and have no contract block. Fatigue does not matter: talking costs
 *   no stamina.
 * - Level 1 takes people not on tonight's card yet; level 2 also takes people already in a match,
 *   within `booking.maxAppearancesPerShow`.
 * - Without a storyline: the first speaker is rolled from the top `aip.card.pickWindow` by talking
 *   ability (weighted by it), and a second joins with `aip.card.secondSpeakerChance`.
 * - With a storyline: every free member who can talk, best talkers first, face side first.
 * - The angle type is a plain roll among the non-hidden types whose speaker range holds the
 *   speakers; a storyline's speakers are then cut to the type's most.
 *
 * Design: docs/design/rival-booking.md#talking-segments.
 */

import type { PersonId, StorylineId } from '../../../core/ids';
import { rollChance, rollPick, rollWeighted } from '../../../core/rng/rolls';
import type { RngStream } from '../../../core/rng/registry';
import { angleTypesOf, type AngleTypeDef } from '../../../model/catalogs';
import type { StorylineSide } from '../../../model/entities/storyline';
import type { GameWorldView } from '../../../model/tables';
import type { EngineTunables } from '../../tunables';
import { emptyCrew, type ParticipantDraft } from '../../booking/draft';
import type { CardBookings } from './fallback';
import { BookerNotes } from './notes';
import { TALKING_DOC_REF } from './tunables';
import type { CardCandidate, CardPool, PlannedSegment } from './types';

export const INJURED_CAN_TALK = 'Injured, but can talk';
export const NO_TALKER_REASON = 'Nobody free to talk tonight';

/** Storyline sides in the order their speakers stand. */
const SIDE_ORDER: readonly StorylineSide[] = ['face', 'heel', 'neutral'];

export interface TalkSegmentArgs {
  /** The planned segment's key (`talk:<n>`, `storyline:<id>`). */
  readonly key: string;
  /** The storyline the segment is part of; its members are the speakers. */
  readonly storylineId?: StorylineId;
  readonly alreadyBooked: CardBookings;
  /** A line at the top of the notes: why there is a talking segment here. */
  readonly sourceNote?: string;
}

export interface TalkSegmentDeps {
  readonly read: GameWorldView;
  readonly tunables: EngineTunables;
  readonly rng: RngStream;
}

interface Speaker {
  readonly candidate: CardCandidate;
  readonly side: number;
}

/** "#1 Haruto Ise (talking 68)". */
function talkerText(candidates: readonly CardCandidate[]): string {
  return candidates
    .map(
      (candidate, index) =>
        `#${String(index + 1)} ${candidate.ringName} (talking ${String(Math.round(candidate.talkValue.value))})`,
    )
    .join(', ');
}

/** Talkers by talking ability, highest first, then the pool's order. */
function byTalk(candidates: readonly CardCandidate[]): CardCandidate[] {
  const order = new Map(candidates.map((candidate, index) => [candidate.personId, index]));
  return [...candidates].sort(
    (left, right) =>
      right.talkValue.value - left.talkValue.value ||
      (order.get(left.personId) ?? 0) - (order.get(right.personId) ?? 0),
  );
}

/** Who may talk at `level` (1: not on the card yet; 2: within the appearance limit). */
function talkersAt(
  pool: CardPool,
  booked: CardBookings,
  maxAppearances: number,
  level: 1 | 2,
  exclude: ReadonlySet<PersonId>,
): CardCandidate[] {
  return pool.candidates.filter((candidate) => {
    if (!candidate.canTalk || candidate.contractBlock !== null || exclude.has(candidate.personId)) {
      return false;
    }
    const appearances = booked.appearances.get(candidate.personId) ?? 0;
    return level === 1 ? appearances === 0 : appearances < maxAppearances;
  });
}

const TALK_LEVEL_TEXT = {
  1: 'Level 1: someone not on the card yet',
  2: 'Level 2: someone already wrestling tonight, within the appearance limit',
} as const;

/** One speaker from the top of `talkers`, by a roll weighted by talking ability. */
function rollSpeaker(
  talkers: readonly CardCandidate[],
  window: number,
  label: string,
  rng: RngStream,
  notes: BookerNotes,
): CardCandidate | null {
  const top = byTalk(talkers).slice(0, window);
  const [only] = top;
  if (only === undefined) {
    return null;
  }
  notes.note(`${label}: ${talkerText(top)}`);
  if (top.length === 1) {
    return only;
  }
  const roll = rollWeighted(
    rng,
    top.map((candidate) => ({ item: candidate, weight: Math.max(1, candidate.talkValue.value) })),
    label,
    (candidate) => candidate.ringName,
  );
  notes.roll(roll.roll);
  return roll.value;
}

/** Up to two speakers from the whole pool. */
function pickSpeakers(
  pool: CardPool,
  args: TalkSegmentArgs,
  deps: TalkSegmentDeps,
  notes: BookerNotes,
): Speaker[] {
  const maxAppearances = deps.tunables.get('booking.maxAppearancesPerShow');
  const window = deps.tunables.get('aip.card.pickWindow');
  const speakers: CardCandidate[] = [];
  for (const level of [1, 2] as const) {
    const talkers = talkersAt(pool, args.alreadyBooked, maxAppearances, level, new Set());
    notes.rule(`First speaker: ${TALK_LEVEL_TEXT[level]}`, talkers.length > 0);
    const first = rollSpeaker(talkers, window, 'First speaker', deps.rng, notes);
    if (first !== null) {
      speakers.push(first);
      break;
    }
  }
  const [first] = speakers;
  if (first === undefined) {
    return [];
  }

  const chance = deps.tunables.get('aip.card.secondSpeakerChance');
  const second = rollChance(deps.rng, chance, 'A second speaker');
  notes.roll(second.roll);
  if (second.value) {
    for (const level of [1, 2] as const) {
      const talkers = talkersAt(
        pool,
        args.alreadyBooked,
        maxAppearances,
        level,
        new Set([first.personId]),
      );
      notes.rule(`Second speaker: ${TALK_LEVEL_TEXT[level]}`, talkers.length > 0);
      const picked = rollSpeaker(talkers, window, 'Second speaker', deps.rng, notes);
      if (picked !== null) {
        speakers.push(picked);
        break;
      }
    }
  }
  return speakers.map((candidate, side) => ({ candidate, side }));
}

/** A storyline's free members who can talk: face side first, best talkers first within a side. */
function storylineSpeakers(
  pool: CardPool,
  storylineId: StorylineId,
  args: TalkSegmentArgs,
  deps: TalkSegmentDeps,
  notes: BookerNotes,
): Speaker[] {
  const storyline = deps.read.tables.storylines.require(storylineId);
  const maxAppearances = deps.tunables.get('booking.maxAppearancesPerShow');
  const free = new Set(
    talkersAt(pool, args.alreadyBooked, maxAppearances, 1, new Set()).map(
      (candidate) => candidate.personId,
    ),
  );
  const byPerson = new Map(pool.candidates.map((candidate) => [candidate.personId, candidate]));
  const speakers: Speaker[] = [];
  SIDE_ORDER.forEach((side, sideIndex) => {
    const members = storyline.members
      .filter((member) => member.side === side && free.has(member.personId))
      .flatMap((member) => {
        const candidate = byPerson.get(member.personId);
        return candidate === undefined ? [] : [candidate];
      });
    for (const candidate of byTalk(members)) {
      speakers.push({ candidate, side: sideIndex });
    }
  });
  notes.note(
    speakers.length === 0
      ? 'Nobody in the story is free to talk'
      : `Free to talk: ${talkerText(speakers.map((speaker) => speaker.candidate))}`,
  );
  return speakers;
}

/** "Haruto Ise and Daichi Kuroe". */
export function speakersLabel(names: readonly string[]): string {
  if (names.length <= 1) {
    return names.join('');
  }
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] ?? ''}`;
}

/**
 * One talking segment, or null when nobody can talk. See the module comment for the rules.
 */
export function buildTalkSegment(
  pool: CardPool,
  args: TalkSegmentArgs,
  deps: TalkSegmentDeps,
): PlannedSegment | null {
  const notes = new BookerNotes();
  if (args.sourceNote !== undefined) {
    notes.note(args.sourceNote);
  }
  let speakers =
    args.storylineId === undefined
      ? pickSpeakers(pool, args, deps, notes)
      : storylineSpeakers(pool, args.storylineId, args, deps, notes);
  if (speakers.length === 0) {
    return null;
  }

  const count = speakers.length;
  const fitting = angleTypesOf(deps.read).filter(
    (type) =>
      type.speakers.min <= count && (args.storylineId !== undefined || type.speakers.max >= count),
  );
  if (fitting.length === 0) {
    notes.note('No kind of angle fits these speakers');
    return null;
  }
  const typeRoll = rollPick<AngleTypeDef>(deps.rng, fitting, 'Kind of angle', (type) => type.name);
  notes.roll(typeRoll.roll);
  const angleType = typeRoll.value;
  if (speakers.length > angleType.speakers.max) {
    notes.note(
      `${angleType.name} takes at most ${String(angleType.speakers.max)}: the best talkers speak`,
    );
    speakers = speakers.slice(0, angleType.speakers.max);
  }

  for (const { candidate } of speakers) {
    if (candidate.availability.status !== 'available') {
      notes.note(`${candidate.ringName}: ${INJURED_CAN_TALK}`);
    }
  }

  const participants: ParticipantDraft[] = speakers.map(({ candidate, side }) => ({
    personId: candidate.personId,
    side,
    role: 'speaker',
    teamId: null,
  }));
  const label = speakersLabel(speakers.map(({ candidate }) => candidate.ringName));
  const because =
    fitting.length === 1
      ? `The only kind of angle for ${String(count)} ${count === 1 ? 'speaker' : 'speakers'}`
      : `Picked from ${String(fitting.length)} kinds of angle`;
  return {
    key: args.key,
    kind: 'angle',
    draft: {
      kind: 'angle',
      label: null,
      storylineIds: args.storylineId === undefined ? [] : [args.storylineId],
      crew: emptyCrew(),
      participants,
      angle: { angleTypeKey: angleType.key },
    },
    source: args.storylineId === undefined ? 'talk' : 'storyline',
    trace: notes.decide(label, angleType.name, because, TALKING_DOC_REF),
  };
}
