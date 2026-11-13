/**
 * The card writer: the one way segments and their participants are put on, changed on and taken
 * off a show's card.
 *
 * The booking commands (EVT2-02) call it after checking who is asking; the rival booker (AIP4)
 * calls it from its phase. Commands check permission, the writer checks structure: every write is
 * checked against the rules in {@link structuralProblems} first and throws `CardWriteError` when
 * one fails, so a write either happens whole or not at all. Each write also runs in a savepoint of
 * its own, so a throw half-way leaves the step's transaction as it was before the call.
 *
 * A card has the fixed slots of its show's format; any of them may be open. Slots are stored from
 * 0 and nothing is ever renumbered: removing a segment leaves its slot open, and moving one swaps
 * it with whatever is in the target slot.
 *
 * Design notes: docs/design/booking.md#the-card-writer.
 */

import type { Reason } from '../../core/api/result';
import type { ContentKey } from '../../core/content-key';
import { CardWriteError, InvalidArgumentError } from '../../core/errors';
import type { EventInstanceId, PersonId, SegmentId } from '../../core/ids';
import { angleTypeOf, finishOf, matchTypeOf, methodOf } from '../../model/catalogs';
import type { Employment } from '../../model/entities/employment';
import { promotionStatusKey } from '../../model/entities/employment';
import type { EventInstance } from '../../model/entities/event-instance';
import {
  segmentSlotKey,
  type AngleBeat,
  type AngleSegment,
  type MatchOutcome,
  type MatchSegment,
  type Segment,
} from '../../model/entities/segment';
import { compareIds } from '../../model/table';
import type { GameTables, GameWorldView } from '../../model/tables';
import type { Tx } from '../../model/tx';
import type { DeepReadonly } from '../../model/world';
import { cardSegments } from './card';
import type { ParticipantDraft, SegmentDraft } from './draft';

/**
 * Where a moving segment waits while it trades places with another, far past any real slot, so the
 * unique `bySlot` index never sees two segments in one slot.
 */
export const PARK_SLOT = 10_000;

/** The reason codes {@link structuralProblems} and the writer can report. */
export const STRUCTURAL_PROBLEM_CODES = [
  'unknownMatchType',
  'unknownAngleType',
  'unknownMethod',
  'unknownPerson',
  'unknownStoryline',
  'duplicatePerson',
  'notOnRoster',
  'teamMismatch',
  'tooFewSides',
  'winnerWithoutCompetitor',
  'titleNotOurs',
  'titleRetired',
  'slotOutsideFormat',
  'slotTaken',
  'notAMatch',
] as const;
export type StructuralProblemCode = (typeof STRUCTURAL_PROBLEM_CODES)[number];

/** A place on a card: a section and a 0-based slot in it. */
export interface CardPosition {
  readonly preShow: boolean;
  readonly slot: number;
}

/** Where a draft is going, and the segment it replaces when it is an edit. */
export interface CardTarget extends CardPosition {
  readonly segmentId?: SegmentId | null;
}

export interface StructuralCheck {
  readonly instance: DeepReadonly<EventInstance>;
  readonly draft: DeepReadonly<SegmentDraft>;
  readonly target: CardTarget;
}

type Problem = Reason & { readonly code: StructuralProblemCode };

/** "Slot 3" or "Pre-show slot 1": slots are stored from 0 and shown from 1. */
function slotName(position: CardPosition): string {
  const shown = String(position.slot + 1);
  return position.preShow ? `Pre-show slot ${shown}` : `Slot ${shown}`;
}

/** "The Boreal Championship", without doubling a name that already starts with "The". */
function theTitle(name: string): string {
  return /^the /i.test(name) ? name : `The ${name}`;
}

/** "Side 2" for stored side 1. */
function sideName(side: number): string {
  return `Side ${String(side + 1)}`;
}

/** The promotion's active contracts, by person. */
function rosterOf(
  read: GameWorldView,
  instance: DeepReadonly<EventInstance>,
): Map<PersonId, DeepReadonly<Employment>> {
  return new Map(
    read.tables.employments
      .lookup('byPromotionStatus', promotionStatusKey(instance.promotionId, 'active'))
      .map((employment) => [employment.personId, employment]),
  );
}

function slotProblems(
  read: GameWorldView,
  instance: DeepReadonly<EventInstance>,
  target: CardTarget,
): Problem[] {
  const capacity = target.preShow ? instance.format.preShowSlots : instance.format.slots;
  if (!Number.isInteger(target.slot) || target.slot < 0 || target.slot >= capacity) {
    return [
      {
        code: 'slotOutsideFormat',
        message: `${slotName(target)} doesn't exist on this show`,
        subject: { kind: 'eventInstance', id: instance.id },
      },
    ];
  }
  const occupant = read.tables.segments.lookupOne(
    'bySlot',
    segmentSlotKey({ eventInstanceId: instance.id, ...target }),
  );
  if (occupant !== undefined && occupant.id !== target.segmentId) {
    return [
      {
        code: 'slotTaken',
        message: `${slotName(target)} already has a segment`,
        subject: { kind: 'segment', id: occupant.id },
      },
    ];
  }
  return [];
}

function participantProblems(
  read: GameWorldView,
  instance: DeepReadonly<EventInstance>,
  participants: readonly DeepReadonly<ParticipantDraft>[],
): Problem[] {
  const roster = rosterOf(read, instance);
  const promotionName = read.tables.promotions.get(instance.promotionId)?.name ?? 'this promotion';
  const problems: Problem[] = [];
  const seen = new Set<PersonId>();
  for (const participant of participants) {
    const person = read.tables.people.get(participant.personId);
    if (person === undefined) {
      problems.push({
        code: 'unknownPerson',
        message: 'Someone on this segment is no longer in the game',
        field: 'participants',
      });
      continue;
    }
    const subject = { kind: 'person', id: person.id } as const;
    const name = roster.get(person.id)?.ringName ?? person.defaultRingName;
    if (seen.has(person.id)) {
      problems.push({
        code: 'duplicatePerson',
        message: `${name} is on this segment twice`,
        subject,
      });
      continue;
    }
    seen.add(person.id);
    if (!roster.has(person.id)) {
      problems.push({
        code: 'notOnRoster',
        message: `${name} isn't on the ${promotionName} roster`,
        subject,
      });
    }
    if (participant.teamId !== null) {
      const team = read.tables.teams.get(participant.teamId);
      if (team === undefined) {
        problems.push({
          code: 'teamMismatch',
          message: `${name} is listed with a team that no longer exists`,
          subject,
        });
      } else if (!team.memberIds.includes(person.id)) {
        problems.push({
          code: 'teamMismatch',
          message: `${name} isn't a member of ${team.name}`,
          subject,
        });
      }
    }
  }
  return problems;
}

/** Crew, beat speakers and storylines must all point at something. */
function referenceProblems(read: GameWorldView, draft: DeepReadonly<SegmentDraft>): Problem[] {
  const problems: Problem[] = [];
  const { refereeId, producerId, announcerIds } = draft.crew;
  const crewIds = [refereeId, producerId, ...announcerIds].filter(
    (personId): personId is PersonId => personId !== null,
  );
  if (crewIds.some((personId) => !read.tables.people.has(personId))) {
    problems.push({
      code: 'unknownPerson',
      message: 'Someone on the crew is no longer in the game',
      field: 'crew',
    });
  }
  const beats = draft.kind === 'angle' ? (draft.angle.beats ?? []) : [];
  if (beats.some((beat) => beat.personIds.some((personId) => !read.tables.people.has(personId)))) {
    problems.push({
      code: 'unknownPerson',
      message: 'Someone in this angle is no longer in the game',
      field: 'angle.beats',
    });
  }
  if (draft.storylineIds.some((storylineId) => !read.tables.storylines.has(storylineId))) {
    problems.push({
      code: 'unknownStoryline',
      message: 'This segment is part of a storyline that no longer exists',
      field: 'storylineIds',
    });
  }
  return problems;
}

/** The sides that have at least one competitor. */
function competitorSidesOf(participants: readonly DeepReadonly<ParticipantDraft>[]): Set<number> {
  return new Set(
    participants
      .filter((participant) => participant.role === 'competitor')
      .map((participant) => participant.side),
  );
}

/**
 * A planned outcome must name a side with a competitor and a method the game offers. A hidden
 * method is allowed only when `existing` already uses it, so an old card stays editable.
 */
function outcomeProblems(
  read: GameWorldView,
  outcome: DeepReadonly<MatchOutcome> | null,
  competitorSides: ReadonlySet<number>,
  existing: DeepReadonly<Segment> | undefined,
): Problem[] {
  if (outcome?.kind !== 'win') {
    return [];
  }
  const problems: Problem[] = [];
  if (!competitorSides.has(outcome.winningSide)) {
    problems.push({
      code: 'winnerWithoutCompetitor',
      message: `${sideName(outcome.winningSide)} has nobody wrestling, so it can't win`,
      field: 'outcome.winningSide',
    });
  }
  const method = methodOf(read, outcome.methodKey);
  const keptHidden =
    existing?.kind === 'match' &&
    existing.outcome?.kind === 'win' &&
    existing.outcome.methodKey === outcome.methodKey;
  if (method === undefined || (method.hidden && !keptHidden)) {
    problems.push({
      code: 'unknownMethod',
      message: "That way of winning isn't available",
      field: 'outcome.methodKey',
    });
  }
  return problems;
}

function matchProblems(
  read: GameWorldView,
  instance: DeepReadonly<EventInstance>,
  draft: DeepReadonly<Extract<SegmentDraft, { kind: 'match' }>>,
  existing: DeepReadonly<Segment> | undefined,
): Problem[] {
  const problems: Problem[] = [];
  const { matchTypeKey } = draft.match;
  const matchType = matchTypeOf(read, matchTypeKey);
  const keptHidden = existing?.kind === 'match' && existing.match.matchTypeKey === matchTypeKey;
  if (matchType === undefined || (matchType.hidden && !keptHidden)) {
    problems.push({
      code: 'unknownMatchType',
      message: "That match type isn't available",
      field: 'match.matchTypeKey',
    });
  }
  const competitorSides = competitorSidesOf(draft.participants);
  if (competitorSides.size < 2) {
    problems.push({
      code: 'tooFewSides',
      message: 'A match needs wrestlers on at least two sides',
      field: 'participants',
    });
  }
  problems.push(...outcomeProblems(read, draft.outcome, competitorSides, existing));
  for (const titleId of draft.match.titleIds) {
    const title = read.tables.titles.get(titleId);
    if (title === undefined) {
      problems.push({
        code: 'titleNotOurs',
        message: 'That title no longer exists',
        field: 'match.titleIds',
      });
    } else if (title.promotionId !== instance.promotionId) {
      problems.push({
        code: 'titleNotOurs',
        message: `${theTitle(title.name)} isn't one of this promotion's titles`,
        field: 'match.titleIds',
        subject: { kind: 'title', id: title.id },
      });
    } else if (title.status === 'retired') {
      problems.push({
        code: 'titleRetired',
        message: `${theTitle(title.name)} has been retired`,
        field: 'match.titleIds',
        subject: { kind: 'title', id: title.id },
      });
    }
  }
  return problems;
}

function angleProblems(
  read: GameWorldView,
  draft: DeepReadonly<Extract<SegmentDraft, { kind: 'angle' }>>,
  existing: DeepReadonly<Segment> | undefined,
): Problem[] {
  const { angleTypeKey } = draft.angle;
  const angleType = angleTypeOf(read, angleTypeKey);
  const keptHidden = existing?.kind === 'angle' && existing.angle.angleTypeKey === angleTypeKey;
  if (angleType === undefined || (angleType.hidden && !keptHidden)) {
    return [
      {
        code: 'unknownAngleType',
        message: "That kind of angle isn't available",
        field: 'angle.angleTypeKey',
      },
    ];
  }
  return [];
}

/**
 * Everything about putting `draft` at `target` on `instance`'s card that would break a card rule or
 * point at nothing, as player-facing reasons; empty when the write is sound. The commands refuse
 * these; softer problems (a wrestler working twice on one show, an uneven match) belong to the
 * booking checks of EVT2-04. Hidden match types, angle types and methods are allowed only when the
 * segment being replaced already uses them.
 */
export function structuralProblems(read: GameWorldView, check: StructuralCheck): Reason[] {
  const { instance, draft, target } = check;
  const existing =
    target.segmentId === undefined || target.segmentId === null
      ? undefined
      : read.tables.segments.get(target.segmentId);
  return [
    ...slotProblems(read, instance, target),
    ...(draft.kind === 'match'
      ? matchProblems(read, instance, draft, existing)
      : angleProblems(read, draft, existing)),
    ...participantProblems(read, instance, draft.participants),
    ...referenceProblems(read, draft),
  ];
}

// ---------------------------------------------------------------------------------------------
// Writes

/** Runs `body` in a savepoint and rethrows its failure, so a write is all or nothing. */
function atomically<T>(tx: Tx<GameTables>, label: string, body: (inner: Tx<GameTables>) => T): T {
  const result = tx.savepoint(label, body);
  if (!result.ok) {
    throw result.error;
  }
  return result.value;
}

function compareSpeakers(
  left: DeepReadonly<ParticipantDraft>,
  right: DeepReadonly<ParticipantDraft>,
): number {
  return left.side - right.side || compareIds(left.personId, right.personId);
}

/** The angle's beats: the draft's own, or its type's default beat spoken by its speakers. */
function beatsOf(
  read: GameWorldView,
  draft: DeepReadonly<Extract<SegmentDraft, { kind: 'angle' }>>,
): AngleBeat[] {
  if (draft.angle.beats !== undefined) {
    return draft.angle.beats.map((beat) => ({
      beatKey: beat.beatKey,
      personIds: [...beat.personIds],
    }));
  }
  const angleType = angleTypeOf(read, draft.angle.angleTypeKey);
  if (angleType === undefined) {
    // structuralProblems has already refused this; kept for the type checker.
    throw new InvalidArgumentError(
      'writeSegment',
      'draft.angle.angleTypeKey',
      draft.angle.angleTypeKey,
      'a known angle type',
    );
  }
  const speakers = draft.participants
    .filter((participant) => participant.role === 'speaker')
    .sort(compareSpeakers)
    .map((participant) => participant.personId);
  return [{ beatKey: angleType.defaultBeatKey, personIds: speakers }];
}

/** A stored segment without its id. */
type SegmentFields = Omit<MatchSegment, 'id'> | Omit<AngleSegment, 'id'>;

/** The stored fields for `draft` at `position`, with no rating. */
function segmentFields(
  read: GameWorldView,
  eventInstanceId: EventInstanceId,
  position: CardPosition,
  draft: DeepReadonly<SegmentDraft>,
): SegmentFields {
  const base = {
    eventInstanceId,
    preShow: position.preShow,
    slot: position.slot,
    label: draft.label,
    storylineIds: [...draft.storylineIds],
    crew: { ...draft.crew, announcerIds: [...draft.crew.announcerIds] },
    rating: null,
  };
  if (draft.kind === 'match') {
    return {
      ...base,
      kind: 'match',
      match: {
        matchTypeKey: draft.match.matchTypeKey,
        stipulationKeys: [...draft.match.stipulationKeys],
        titleIds: [...draft.match.titleIds],
        finishKey: draft.match.finishKey,
      },
      outcome: draft.outcome === null ? null : { ...draft.outcome },
    };
  }
  return {
    ...base,
    kind: 'angle',
    angle: { angleTypeKey: draft.angle.angleTypeKey, beats: beatsOf(read, draft) },
  };
}

/**
 * Makes the segment's participants match `wanted`, diffed by person: people already on it keep
 * their row (and id), with side, role and team updated if they changed; people no longer wanted
 * are deleted; new people are created in person id order, so the same calls always mint the same
 * ids.
 */
function syncParticipants(
  tx: Tx<GameTables>,
  segmentId: SegmentId,
  wanted: readonly DeepReadonly<ParticipantDraft>[],
): void {
  const byPerson = new Map(wanted.map((participant) => [participant.personId, participant]));
  const current = tx.view.tables.participants.lookup('bySegment', segmentId);
  const kept = new Set<PersonId>();
  for (const row of current) {
    const next = byPerson.get(row.personId);
    if (next === undefined) {
      tx.delete('participants', row.id);
      continue;
    }
    kept.add(row.personId);
    if (next.side !== row.side || next.role !== row.role || next.teamId !== row.teamId) {
      tx.update('participants', row.id, { side: next.side, role: next.role, teamId: next.teamId });
    }
  }
  const added = wanted
    .filter((participant) => !kept.has(participant.personId))
    .sort((left, right) => compareIds(left.personId, right.personId));
  for (const participant of added) {
    tx.create('participants', {
      segmentId,
      personId: participant.personId,
      side: participant.side,
      role: participant.role,
      teamId: participant.teamId,
      entranceOrder: null,
      eliminationOrder: null,
    });
  }
}

export interface WriteSegmentArgs extends CardPosition {
  readonly eventInstanceId: EventInstanceId;
  readonly draft: DeepReadonly<SegmentDraft>;
  /** The segment to replace in place; left out to add a new one. */
  readonly segmentId?: SegmentId | null;
}

/**
 * Puts `draft` on the card at `preShow`/`slot`. With `segmentId` the segment is replaced in place
 * and keeps its id, even when it changes from a match to an angle; without it a new segment is
 * created. The rating is always cleared. Participants are diffed by person (see the module notes).
 * An angle without beats gets its type's default beat, spoken by its speakers in side order.
 *
 * @throws CardWriteError when {@link structuralProblems} reports anything; nothing is written.
 * @throws EntityNotFoundError for an unknown show or segment.
 */
export function writeSegment(tx: Tx<GameTables>, args: WriteSegmentArgs): SegmentId {
  return atomically(tx, 'booking.writeSegment', (inner) => {
    const read = inner.view;
    const instance = read.tables.eventInstances.require(args.eventInstanceId);
    const segmentId = args.segmentId ?? null;
    const existing = segmentId === null ? undefined : read.tables.segments.require(segmentId);
    if (existing !== undefined && existing.eventInstanceId !== instance.id) {
      throw new InvalidArgumentError(
        'writeSegment',
        'segmentId',
        existing.id,
        `a segment on ${instance.id}`,
      );
    }
    const problems = structuralProblems(read, {
      instance,
      draft: args.draft,
      target: { preShow: args.preShow, slot: args.slot, segmentId },
    });
    if (problems.length > 0) {
      throw new CardWriteError('writeSegment', problems);
    }
    const fields = segmentFields(read, instance.id, args, args.draft);
    let id: SegmentId;
    if (existing === undefined) {
      id = inner.create('segments', fields).id;
    } else {
      id = existing.id;
      const row: Segment = { id, ...fields };
      inner.update('segments', id, () => row);
    }
    syncParticipants(inner, id, args.draft.participants);
    return id;
  });
}

/**
 * Takes a segment off its card: its participants first, then the segment. Its slot becomes open;
 * nothing else moves.
 *
 * @throws EntityNotFoundError for an unknown segment.
 */
export function removeSegment(tx: Tx<GameTables>, segmentId: SegmentId): void {
  atomically(tx, 'booking.removeSegment', (inner) => {
    inner.view.tables.segments.require(segmentId);
    for (const participant of inner.view.tables.participants.lookup('bySegment', segmentId)) {
      inner.delete('participants', participant.id);
    }
    inner.delete('segments', segmentId);
  });
}

/** Takes every segment off the show's card and returns their ids, in running order. */
export function clearCard(tx: Tx<GameTables>, eventInstanceId: EventInstanceId): SegmentId[] {
  return atomically(tx, 'booking.clearCard', (inner) => {
    const removed = cardSegments(inner.view, eventInstanceId).map((segment) => segment.id);
    for (const segmentId of removed) {
      removeSegment(inner, segmentId);
    }
    return removed;
  });
}

/**
 * True when a planned result can end with the planned finish (MTCH2): the same outcome kind, and
 * for a win one of the finish's methods. A result decided on the night fits any finish.
 */
function outcomeFitsFinish(
  read: GameWorldView,
  finishKey: string,
  outcome: DeepReadonly<MatchOutcome> | null,
): boolean {
  if (outcome === null) {
    return true;
  }
  const finish = finishOf(read, finishKey);
  if (finish?.outcomeKind !== outcome.kind) {
    return false;
  }
  return (
    outcome.kind !== 'win' ||
    finish.methods.some((method) => method.methodKey === outcome.methodKey)
  );
}

/**
 * Sets a match's planned result, or clears it with null (decided on the night). The winning side
 * must have a competitor and the method must be one the game offers. A planned finish the new
 * result cannot end with (a draw on a Disqualification, a pinfall on a Count-out) goes back to
 * Auto (`finishKey: null`), so the card never holds a finish that contradicts its result.
 *
 * With `finishKey` (a computer booker planning the finish with the result, AIP5-06) the finish is
 * set too: it must end with the planned result (the same outcome kind and, for a win, list the
 * method), and null sets Auto.
 *
 * @throws CardWriteError for an angle or an outcome that breaks those rules, or a finish the
 *   result cannot end with; nothing is written.
 * @throws EntityNotFoundError for an unknown segment.
 */
export function setPlannedOutcome(
  tx: Tx<GameTables>,
  segmentId: SegmentId,
  outcome: DeepReadonly<MatchOutcome> | null,
  finishKey?: ContentKey | null,
): void {
  atomically(tx, 'booking.setPlannedOutcome', (inner) => {
    const read = inner.view;
    const segment = read.tables.segments.require(segmentId);
    if (segment.kind !== 'match') {
      throw new CardWriteError('setPlannedOutcome', [
        { code: 'notAMatch', message: 'Only a match has a result to plan' },
      ]);
    }
    const competitorSides = competitorSidesOf(
      read.tables.participants.lookup('bySegment', segmentId),
    );
    const problems = outcomeProblems(read, outcome, competitorSides, segment);
    if (problems.length > 0) {
      throw new CardWriteError('setPlannedOutcome', problems);
    }
    const planned: MatchOutcome | null = outcome === null ? null : { ...outcome };
    if (
      finishKey !== undefined &&
      finishKey !== null &&
      !outcomeFitsFinish(read, finishKey, planned)
    ) {
      throw new CardWriteError('setPlannedOutcome', [
        {
          code: 'finishOutcomeMismatch',
          message: `The finish ${finishOf(read, finishKey)?.name ?? finishKey} can't end with this result`,
        },
      ]);
    }
    const current = finishKey === undefined ? segment.match.finishKey : finishKey;
    const keptFinish =
      current !== null && outcomeFitsFinish(read, current, planned) ? current : null;
    inner.update('segments', segmentId, (previous) =>
      previous.kind === 'match'
        ? { ...previous, match: { ...previous.match, finishKey: keptFinish }, outcome: planned }
        : previous,
    );
  });
}

/**
 * Moves a segment to `target`, swapping: an open target slot just takes the segment, and a filled
 * one sends its segment back to where the moving one was. Moves across sections are allowed when
 * the target slot exists. The moving segment is parked at {@link PARK_SLOT} first, so the unique
 * `bySlot` index never holds two segments in one slot.
 *
 * @throws CardWriteError when the target slot is not on the show's format; nothing is written.
 * @throws EntityNotFoundError for an unknown segment.
 */
export function moveSegment(
  tx: Tx<GameTables>,
  segmentId: SegmentId,
  target: CardPosition,
): { swappedWith: SegmentId | null } {
  return atomically(tx, 'booking.moveSegment', (inner) => {
    const read = inner.view;
    const segment = read.tables.segments.require(segmentId);
    const instance = read.tables.eventInstances.require(segment.eventInstanceId);
    const outside = slotProblems(read, instance, { ...target, segmentId }).filter(
      (problem) => problem.code === 'slotOutsideFormat',
    );
    if (outside.length > 0) {
      throw new CardWriteError('moveSegment', outside);
    }
    if (segment.preShow === target.preShow && segment.slot === target.slot) {
      return { swappedWith: null };
    }
    const from: CardPosition = { preShow: segment.preShow, slot: segment.slot };
    const occupant = read.tables.segments.lookupOne(
      'bySlot',
      segmentSlotKey({ eventInstanceId: instance.id, ...target }),
    );
    inner.update('segments', segmentId, (previous) => ({ ...previous, slot: PARK_SLOT }));
    if (occupant !== undefined) {
      inner.update('segments', occupant.id, (previous) => ({ ...previous, ...from }));
    }
    inner.update('segments', segmentId, (previous) => ({
      ...previous,
      preShow: target.preShow,
      slot: target.slot,
    }));
    return { swappedWith: occupant?.id ?? null };
  });
}
