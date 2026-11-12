// The card writer. Design: docs/design/booking.md#the-card-writer
import { describe, expect, it } from 'vitest';
import { parseContentKey } from '../../../src/core/content-key';
import { parseGameDate } from '../../../src/core/date';
import { CardWriteError } from '../../../src/core/errors';
import type { EventInstanceId, PersonId, SegmentId, TeamId, TitleId } from '../../../src/core/ids';
import type { Catalogs } from '../../../src/model/catalogs';
import type { MatchOutcome } from '../../../src/model/entities/segment';
import { checkWorld } from '../../../src/model/integrity';
import { TABLES, type GameTables, type GameWorld } from '../../../src/model/tables';
import type { Tx } from '../../../src/model/tx';
import {
  AngleDraftSchema,
  cardSegments,
  clearCard,
  draftFromSegment,
  hasCard,
  MatchDraftSchema,
  moveSegment,
  PARK_SLOT,
  removeSegment,
  setPlannedOutcome,
  structuralProblems,
  writeSegment,
  type AngleDraft,
  type CardTarget,
  type MatchDraft,
  type ParticipantDraft,
  type SegmentDraft,
} from '../../../src/systems/booking';
import { aMatch, aParticipant, aTeam, TEST_CATALOGS, testId, worldBuilder } from '../../support';

const START = '2026-01-05';
const key = parseContentKey;
const PINFALL = key('method.pinfall');
/** Ids that point at nothing. */
const GHOST_PERSON = testId('person', 9999);
const GHOST_TITLE = testId('title', 9999);
const GHOST_STORYLINE = testId('storyline', 9999);

/** `value`, or a test failure naming `what` when it is missing. */
function only<T>(value: T | undefined, what: string): T {
  if (value === undefined) {
    throw new Error(`The test world has no ${what}`);
  }
  return value;
}

interface BookingWorld {
  readonly world: GameWorld;
  readonly show: EventInstanceId;
  /** Promotion A's roster of 10. */
  readonly roster: readonly PersonId[];
  /** On promotion B's roster, not A's. */
  readonly outsider: PersonId;
  /** Roster 0 and 1. */
  readonly team: TeamId;
  readonly ourTitle: TitleId;
  readonly retiredTitle: TitleId;
  readonly theirTitle: TitleId;
}

interface BookingWorldOptions {
  readonly catalogs?: Catalogs;
  /** Puts a singles match (roster 0 v roster 1, side 1 planned to win by pinfall) in slot 0. */
  readonly existingMatch?: boolean;
}

/**
 * Promotion A with a roster of 10, two titles (one retired) and a team; promotion B with one
 * wrestler and a title; and A's scheduled show with 6 main-card slots and 1 pre-show slot.
 */
function bookingWorld(options: BookingWorldOptions = {}): BookingWorld {
  const { world, ids } = worldBuilder({ startDate: START })
    .withCatalogs(options.catalogs)
    .withGeography('mini')
    .withPromotion({ name: 'Test Promotion A' }, (promotion) =>
      promotion
        .withRoster(10)
        .withTitle({ name: 'Test Heavyweight Title' })
        .withTitle({
          name: 'The Old Crown',
          status: 'retired',
          retiredOn: parseGameDate(START),
        }),
    )
    .withPromotion({ name: 'Test Promotion B' }, (promotion) =>
      promotion.withRoster(1).withTitle({ name: 'Test Rival Title' }),
    )
    .withEventInstance({ format: { slots: 6, preShowSlots: 1 } })
    .with('team and existing card', (context) => {
      const first = only(context.ids.people[0], 'roster 0');
      const second = only(context.ids.people[1], 'roster 1');
      context.insert(
        'teams',
        aTeam({ name: 'Test Team', memberIds: [first, second] }, context.sequence),
      );
      if (options.existingMatch !== true) {
        return;
      }
      const match = context.insert(
        'segments',
        aMatch(
          {
            eventInstanceId: only(context.ids.eventInstances[0], 'show'),
            slot: 0,
            outcome: { kind: 'win', winningSide: 1, methodKey: PINFALL },
          },
          context.sequence,
        ),
      );
      [first, second].forEach((personId, side) => {
        context.insert(
          'participants',
          aParticipant({ segmentId: match.id, personId, side }, context.sequence),
        );
      });
    })
    .build();
  return {
    world,
    show: only(ids.eventInstances[0], 'show'),
    roster: ids.people.slice(0, 10),
    outsider: only(ids.people[10], 'outsider'),
    team: only(ids.teams[0], 'team'),
    ourTitle: only(ids.titles[0], 'title'),
    retiredTitle: only(ids.titles[1], 'retired title'),
    theirTitle: only(ids.titles[2], 'rival title'),
  };
}

/** Roster index `index`. */
function person(booking: BookingWorld, index: number): PersonId {
  return only(booking.roster[index], `roster index ${String(index)}`);
}

function competitor(personId: PersonId, side: number): ParticipantDraft {
  return { personId, side, role: 'competitor', teamId: null };
}

function speaker(personId: PersonId, side: number): ParticipantDraft {
  return { personId, side, role: 'speaker', teamId: null };
}

/** A singles match between the two people. Everything later sections own is left to default. */
function singles(left: PersonId, right: PersonId, outcome: MatchOutcome | null = null): MatchDraft {
  return MatchDraftSchema.parse({
    kind: 'match',
    label: null,
    match: { matchTypeKey: key('match.singles') },
    participants: [competitor(left, 0), competitor(right, 1)],
    outcome,
  });
}

function angle(
  angleTypeKey: string,
  participants: ParticipantDraft[],
  beats?: { beatKey: string; personIds: PersonId[] }[],
): AngleDraft {
  return AngleDraftSchema.parse({
    kind: 'angle',
    label: null,
    angle: {
      angleTypeKey: key(angleTypeKey),
      ...(beats === undefined
        ? {}
        : { beats: beats.map((beat) => ({ ...beat, beatKey: key(beat.beatKey) })) }),
    },
    participants,
  });
}

/** Runs `body` in one transaction, fails on a throw, and checks the world is still sound. */
function write<T>(world: GameWorld, body: (tx: Tx<GameTables>) => T): T {
  const result = world.transact('test write', body);
  if (!result.ok) {
    throw result.error;
  }
  expect(checkWorld(world, TABLES).issues).toEqual([]);
  return result.value;
}

/** `main 2 seg_...` / `pre 0 seg_...` for each segment on the card, in running order. */
function layout(world: GameWorld, show: EventInstanceId): string[] {
  return cardSegments(world, show).map(
    (segment) => `${segment.preShow ? 'pre' : 'main'} ${String(segment.slot)} ${segment.id}`,
  );
}

function participantsOf(world: GameWorld, segmentId: SegmentId) {
  return world.tables.participants
    .lookup('bySegment', segmentId)
    .map(({ id, personId, side, role, teamId }) => ({ id, personId, side, role, teamId }));
}

/** The reason codes of the `CardWriteError` `body` throws inside a transaction, or null. */
function refusedCodes(world: GameWorld, body: (tx: Tx<GameTables>) => unknown): string[] | null {
  const result = world.transact('refused write', body);
  if (result.ok || !(result.error instanceof CardWriteError)) {
    return null;
  }
  return result.error.reasons.map((reason) => reason.code);
}

/** `tx`, except that its `failAt`-th update (counting inside savepoints too) throws. */
function failingOnUpdate(tx: Tx<GameTables>, failAt: number): Tx<GameTables> {
  let updates = 0;
  const wrap = (inner: Tx<GameTables>): Tx<GameTables> => ({
    get label() {
      return inner.label;
    },
    get view() {
      return inner.view;
    },
    insert: (table, row) => inner.insert(table, row),
    create: (table, fields) => inner.create(table, fields),
    update: (table, id, change) => {
      updates += 1;
      if (updates === failAt) {
        throw new Error('disk on fire');
      }
      return inner.update(table, id, change);
    },
    delete: (table, id) => {
      inner.delete(table, id);
    },
    setMeta: (patch) => {
      inner.setMeta(patch);
    },
    savepoint: (label, body) => inner.savepoint(label, (nested) => body(wrap(nested))),
  });
  return wrap(tx);
}

/** A booking world with one singles match written at each position, in order. */
function cardWith(positions: readonly { preShow: boolean; slot: number }[]) {
  const booking = bookingWorld();
  const { world, show } = booking;
  const ids = write(world, (tx) =>
    positions.map((position, index) =>
      writeSegment(tx, {
        eventInstanceId: show,
        ...position,
        draft: singles(person(booking, index * 2), person(booking, index * 2 + 1)),
      }),
    ),
  );
  return { ...booking, ids };
}

describe('writeSegment', () => {
  it('adds to slot 5 with slots 0-4 open, filling in the defaults', () => {
    const booking = bookingWorld();
    const { world, show } = booking;
    expect(hasCard(world, show)).toBe(false);
    const id = write(world, (tx) =>
      writeSegment(tx, {
        eventInstanceId: show,
        preShow: false,
        slot: 5,
        draft: singles(person(booking, 0), person(booking, 1)),
      }),
    );
    expect(hasCard(world, show)).toBe(true);
    expect(layout(world, show)).toEqual([`main 5 ${id}`]);
    expect(world.tables.segments.get(id)).toMatchObject({
      kind: 'match',
      rating: null,
      storylineIds: [],
      crew: { refereeId: null, producerId: null, announcerIds: [] },
      match: { stipulationKeys: [], titleIds: [], finishKey: null },
      outcome: null,
    });
  });

  it('fills slots in any order and lists the card pre-show first, then by slot', () => {
    const { world, show, ids } = cardWith([
      { preShow: false, slot: 3 },
      { preShow: true, slot: 0 },
      { preShow: false, slot: 0 },
    ]);
    const [third, pre, first] = ids;
    expect(layout(world, show)).toEqual([
      `pre 0 ${String(pre)}`,
      `main 0 ${String(first)}`,
      `main 3 ${String(third)}`,
    ]);
  });

  it('stores a planned outcome on a show that has not run', () => {
    const booking = bookingWorld();
    const planned: MatchOutcome = { kind: 'win', winningSide: 1, methodKey: PINFALL };
    const id = write(booking.world, (tx) =>
      writeSegment(tx, {
        eventInstanceId: booking.show,
        preShow: false,
        slot: 2,
        draft: singles(person(booking, 0), person(booking, 1), planned),
      }),
    );
    expect(booking.world.tables.segments.get(id)).toMatchObject({ outcome: planned });
  });

  it('replaces a match with an angle in place, keeping the id and giving the default beat', () => {
    const booking = bookingWorld();
    const { world, show } = booking;
    const id = write(world, (tx) =>
      writeSegment(tx, {
        eventInstanceId: show,
        preShow: false,
        slot: 2,
        draft: singles(person(booking, 0), person(booking, 1), {
          kind: 'win',
          winningSide: 0,
          methodKey: PINFALL,
        }),
      }),
    );
    const promo = {
      ...angle('angle.promo', [
        speaker(person(booking, 4), 1),
        speaker(person(booking, 3), 1),
        speaker(person(booking, 5), 0),
        { personId: person(booking, 6), side: 0, role: 'subject', teamId: null },
      ]),
      label: 'Contract talk',
    };
    const replaced = write(world, (tx) =>
      writeSegment(tx, {
        eventInstanceId: show,
        preShow: false,
        slot: 2,
        draft: promo,
        segmentId: id,
      }),
    );
    expect(replaced).toBe(id);
    expect(world.tables.segments.ids()).toEqual([id]);
    const stored = world.tables.segments.get(id);
    expect(stored).toMatchObject({ kind: 'angle', label: 'Contract talk', slot: 2, rating: null });
    expect(stored).not.toHaveProperty('outcome');
    // Speakers by side, then by person id; the subject does not speak.
    expect(stored?.kind === 'angle' ? stored.angle.beats : null).toEqual([
      {
        beatKey: key('beat.promo'),
        personIds: [person(booking, 5), person(booking, 3), person(booking, 4)],
      },
    ]);
  });

  it("keeps an angle's own beats when the draft gives them", () => {
    const booking = bookingWorld();
    const beats = [
      { beatKey: 'beat.callout', personIds: [person(booking, 1)] },
      { beatKey: 'beat.brawl', personIds: [person(booking, 1), person(booking, 2)] },
    ];
    const id = write(booking.world, (tx) =>
      writeSegment(tx, {
        eventInstanceId: booking.show,
        preShow: true,
        slot: 0,
        draft: angle(
          'angle.confrontation',
          [speaker(person(booking, 1), 0), speaker(person(booking, 2), 1)],
          beats,
        ),
      }),
    );
    expect(draftFromSegment(booking.world, id)).toMatchObject({
      kind: 'angle',
      angle: { beats: beats.map((beat) => ({ ...beat, beatKey: key(beat.beatKey) })) },
    });
  });

  it('keeps participant ids for unchanged people, updates changed ones and adds new ones in id order', () => {
    const booking = bookingWorld();
    const { world, show } = booking;
    const [p0, p1, p2, p3, p4] = [0, 1, 2, 3, 4].map((index) => person(booking, index));
    if (
      p0 === undefined ||
      p1 === undefined ||
      p2 === undefined ||
      p3 === undefined ||
      p4 === undefined
    ) {
      throw new Error('The roster is too short');
    }
    const threeWay = (participants: ParticipantDraft[]): MatchDraft => ({
      ...singles(p0, p1),
      match: { ...singles(p0, p1).match, matchTypeKey: key('match.triple-threat') },
      participants,
    });
    const id = write(world, (tx) =>
      writeSegment(tx, {
        eventInstanceId: show,
        preShow: false,
        slot: 0,
        draft: threeWay([competitor(p0, 0), competitor(p1, 1), competitor(p2, 2)]),
      }),
    );
    const before = new Map(participantsOf(world, id).map((row) => [row.personId, row.id]));

    // p0 unchanged; p1 now with the team; p2 dropped; p4 and p3 added, listed out of order.
    const edited = threeWay([
      competitor(p4, 2),
      competitor(p0, 0),
      { ...competitor(p1, 1), teamId: booking.team },
      { ...competitor(p3, 1), role: 'ringside' },
    ]);
    write(world, (tx) =>
      writeSegment(tx, {
        eventInstanceId: show,
        preShow: false,
        slot: 0,
        draft: edited,
        segmentId: id,
      }),
    );
    const after = participantsOf(world, id);
    expect(after.find((row) => row.personId === p0)?.id).toBe(before.get(p0));
    expect(after.find((row) => row.personId === p1)).toMatchObject({
      id: before.get(p1),
      side: 1,
      teamId: booking.team,
    });
    expect(after.some((row) => row.personId === p2)).toBe(false);
    // New rows are created in person id order, so p3's row id comes before p4's.
    const newIds = [p3, p4].map((personId) => after.find((row) => row.personId === personId)?.id);
    expect(newIds).toEqual([...newIds].sort());
    expect(world.tables.participants.ids()).toHaveLength(4);
  });

  it('gives the same ids for the same calls in the same order', () => {
    function run(): unknown {
      const booking = bookingWorld();
      const { world, show } = booking;
      write(world, (tx) => {
        const first = writeSegment(tx, {
          eventInstanceId: show,
          preShow: false,
          slot: 4,
          draft: singles(person(booking, 5), person(booking, 2)),
        });
        writeSegment(tx, {
          eventInstanceId: show,
          preShow: false,
          slot: 1,
          draft: singles(person(booking, 7), person(booking, 8)),
        });
        writeSegment(tx, {
          eventInstanceId: show,
          preShow: false,
          slot: 4,
          segmentId: first,
          draft: singles(person(booking, 9), person(booking, 2)),
        });
      });
      return {
        segments: world.tables.segments.values(),
        participants: world.tables.participants.values(),
      };
    }
    expect(run()).toEqual(run());
  });

  it('writes a segment back unchanged from draftFromSegment', () => {
    const booking = bookingWorld({ existingMatch: true });
    const { world, show } = booking;
    const existing = only(cardSegments(world, show)[0], 'existing match');
    const before = {
      segment: world.tables.segments.get(existing.id),
      participants: participantsOf(world, existing.id),
    };
    const id = write(world, (tx) =>
      writeSegment(tx, {
        eventInstanceId: show,
        preShow: false,
        slot: 0,
        segmentId: existing.id,
        draft: draftFromSegment(world, existing.id),
      }),
    );
    expect(id).toBe(existing.id);
    expect({
      segment: world.tables.segments.get(id),
      participants: participantsOf(world, id),
    }).toEqual(before);
  });
});

describe('removeSegment and clearCard', () => {
  const threeSlots = [0, 1, 2].map((slot) => ({ preShow: false, slot }));

  it('leaves a gap where the segment was and moves nothing else', () => {
    const { world, show, ids } = cardWith(threeSlots);
    const [first, middle, last] = ids;
    const removed = only(middle, 'middle segment');
    write(world, (tx) => {
      removeSegment(tx, removed);
    });
    expect(layout(world, show)).toEqual([`main 0 ${String(first)}`, `main 2 ${String(last)}`]);
    expect(world.tables.participants.lookup('bySegment', removed)).toEqual([]);
    expect(world.tables.participants.ids()).toHaveLength(4);
  });

  it('clears the whole card and returns what it removed in running order', () => {
    const { world, show, ids } = cardWith(threeSlots);
    expect(write(world, (tx) => clearCard(tx, show))).toEqual(ids);
    expect(hasCard(world, show)).toBe(false);
    expect(world.tables.participants.ids()).toHaveLength(0);
  });
});

describe('moveSegment', () => {
  it('swaps two filled slots', () => {
    const { world, show, ids } = cardWith([
      { preShow: false, slot: 1 },
      { preShow: false, slot: 4 },
    ]);
    const [upper, lower] = ids;
    const result = write(world, (tx) =>
      moveSegment(tx, only(upper, 'segment'), { preShow: false, slot: 4 }),
    );
    expect(result).toEqual({ swappedWith: lower });
    expect(layout(world, show)).toEqual([`main 1 ${String(lower)}`, `main 4 ${String(upper)}`]);
  });

  it('moves into an open slot without touching anything else', () => {
    const { world, show, ids } = cardWith([
      { preShow: false, slot: 1 },
      { preShow: false, slot: 4 },
    ]);
    const [moving, staying] = ids;
    const result = write(world, (tx) =>
      moveSegment(tx, only(moving, 'segment'), { preShow: false, slot: 2 }),
    );
    expect(result).toEqual({ swappedWith: null });
    expect(layout(world, show)).toEqual([`main 2 ${String(moving)}`, `main 4 ${String(staying)}`]);
  });

  it('moves from the main card to the pre-show, and swaps across sections', () => {
    const { world, show, ids } = cardWith([
      { preShow: false, slot: 5 },
      { preShow: false, slot: 0 },
    ]);
    const [mainEvent, opener] = ids;
    write(world, (tx) => moveSegment(tx, only(mainEvent, 'segment'), { preShow: true, slot: 0 }));
    expect(layout(world, show)).toEqual([`pre 0 ${String(mainEvent)}`, `main 0 ${String(opener)}`]);
    const swapped = write(world, (tx) =>
      moveSegment(tx, only(opener, 'segment'), { preShow: true, slot: 0 }),
    );
    expect(swapped).toEqual({ swappedWith: mainEvent });
    expect(layout(world, show)).toEqual([`pre 0 ${String(opener)}`, `main 0 ${String(mainEvent)}`]);
  });

  it('does nothing for a move to where the segment already is', () => {
    const { world, show, ids } = cardWith([{ preShow: false, slot: 3 }]);
    const segmentId = only(ids[0], 'segment');
    expect(write(world, (tx) => moveSegment(tx, segmentId, { preShow: false, slot: 3 }))).toEqual({
      swappedWith: null,
    });
    expect(layout(world, show)).toEqual([`main 3 ${segmentId}`]);
  });

  it('refuses a slot past the format and leaves the card as it was', () => {
    const { world, show, ids } = cardWith([{ preShow: false, slot: 3 }]);
    const segmentId = only(ids[0], 'segment');
    const before = layout(world, show);
    for (const target of [
      { preShow: false, slot: 6 },
      { preShow: true, slot: 1 },
      { preShow: false, slot: PARK_SLOT },
    ]) {
      expect(refusedCodes(world, (tx) => moveSegment(tx, segmentId, target))).toEqual([
        'slotOutsideFormat',
      ]);
      expect(layout(world, show)).toEqual(before);
    }
  });

  it('rolls back only its own savepoint when a write inside it throws', () => {
    const booking = cardWith([
      { preShow: false, slot: 1 },
      { preShow: false, slot: 4 },
    ]);
    const { world, show, ids } = booking;
    const segmentId = only(ids[0], 'segment');
    const before = layout(world, show);
    const result = world.transact('move then fail', (tx) => {
      const added = writeSegment(tx, {
        eventInstanceId: show,
        preShow: false,
        slot: 0,
        draft: singles(person(booking, 8), person(booking, 9)),
      });
      // A swap is three updates: park, send the occupant back, land. Fail on the last one.
      expect(() =>
        moveSegment(failingOnUpdate(tx, 3), segmentId, { preShow: false, slot: 4 }),
      ).toThrow('disk on fire');
      return added;
    });
    if (!result.ok) {
      throw result.error;
    }
    expect(layout(world, show)).toEqual([`main 0 ${result.value}`, ...before]);
    expect(checkWorld(world, TABLES).issues).toEqual([]);
  });
});

describe('setPlannedOutcome', () => {
  it('sets and clears a planned result', () => {
    const booking = bookingWorld({ existingMatch: true });
    const { world, show } = booking;
    const id = only(cardSegments(world, show)[0], 'match').id;
    write(world, (tx) => {
      setPlannedOutcome(tx, id, { kind: 'win', winningSide: 0, methodKey: PINFALL });
    });
    expect(world.tables.segments.get(id)).toMatchObject({
      outcome: { kind: 'win', winningSide: 0 },
    });
    write(world, (tx) => {
      setPlannedOutcome(tx, id, null);
    });
    expect(world.tables.segments.get(id)).toMatchObject({ outcome: null });
  });

  it('refuses a winner with no competitor, an unknown method and an angle', () => {
    const booking = bookingWorld({ existingMatch: true });
    const { world, show } = booking;
    const id = only(cardSegments(world, show)[0], 'match').id;
    const angleId = write(world, (tx) =>
      writeSegment(tx, {
        eventInstanceId: show,
        preShow: false,
        slot: 1,
        draft: angle('angle.promo', [speaker(person(booking, 5), 0)]),
      }),
    );
    const refused = (segmentId: SegmentId, outcome: MatchOutcome) =>
      refusedCodes(world, (tx) => {
        setPlannedOutcome(tx, segmentId, outcome);
      });
    expect(refused(id, { kind: 'win', winningSide: 2, methodKey: PINFALL })).toEqual([
      'winnerWithoutCompetitor',
    ]);
    expect(refused(id, { kind: 'win', winningSide: 0, methodKey: key('method.magic') })).toEqual([
      'unknownMethod',
    ]);
    expect(refused(angleId, { kind: 'draw' })).toEqual(['notAMatch']);
    expect(world.tables.segments.get(id)).toMatchObject({ outcome: { winningSide: 1 } });
  });
});

describe('structuralProblems', () => {
  const booking = bookingWorld({ existingMatch: true });
  const { world, show } = booking;
  const instance = world.tables.eventInstances.require(show);
  const existing = only(cardSegments(world, show)[0], 'existing match');
  const fresh: CardTarget = { preShow: false, slot: 3 };
  const wrestler = (index: number): PersonId => person(booking, index);

  function problemsFor(draft: SegmentDraft, target: CardTarget = fresh) {
    return structuralProblems(world, { instance, draft, target });
  }

  function codesFor(draft: SegmentDraft, target: CardTarget = fresh) {
    return problemsFor(draft, target).map((problem) => problem.code);
  }

  const sound = singles(wrestler(2), wrestler(3));

  it('is empty for a sound draft', () => {
    expect(codesFor(sound)).toEqual([]);
  });

  it.each([
    ['slotOutsideFormat', { preShow: false, slot: 6 }, "Slot 7 doesn't exist on this show"],
    ['slotOutsideFormat', { preShow: true, slot: 1 }, "Pre-show slot 2 doesn't exist on this show"],
    ['slotTaken', { preShow: false, slot: 0 }, 'Slot 1 already has a segment'],
  ] as const)('reports %s for %o', (code, target, message) => {
    expect(problemsFor(sound, target)).toEqual([expect.objectContaining({ code, message })]);
  });

  it('lets a segment stay in its own slot', () => {
    const target = { preShow: false, slot: 0, segmentId: existing.id };
    expect(codesFor(singles(wrestler(0), wrestler(1)), target)).toEqual([]);
  });

  it('reports unknown match types, angle types and methods', () => {
    expect(
      codesFor({ ...sound, match: { ...sound.match, matchTypeKey: key('match.cage-of-doom') } }),
    ).toEqual(['unknownMatchType']);
    expect(codesFor(angle('angle.seance', [speaker(wrestler(2), 0)]))).toEqual([
      'unknownAngleType',
    ]);
    expect(
      codesFor({
        ...sound,
        outcome: { kind: 'win', winningSide: 1, methodKey: key('method.magic') },
      }),
    ).toEqual(['unknownMethod']);
  });

  it('reports people who are missing, twice on the segment, off the roster or not in their team', () => {
    expect(codesFor(singles(wrestler(2), GHOST_PERSON))).toEqual(['unknownPerson']);
    expect(
      codesFor({
        ...sound,
        participants: [
          competitor(wrestler(2), 0),
          competitor(wrestler(3), 1),
          competitor(wrestler(2), 1),
        ],
      }),
    ).toEqual(['duplicatePerson']);

    const outsider = problemsFor(singles(wrestler(2), booking.outsider));
    expect(outsider.map((problem) => problem.code)).toEqual(['notOnRoster']);
    expect(outsider[0]?.message).toMatch(/isn't on the Test Promotion A roster$/);

    const withTeam = (teamMember: PersonId) =>
      problemsFor({
        ...sound,
        participants: [
          { ...competitor(teamMember, 0), teamId: booking.team },
          competitor(wrestler(3), 1),
        ],
      });
    const wrongTeam = withTeam(wrestler(2));
    expect(wrongTeam.map((problem) => problem.code)).toEqual(['teamMismatch']);
    expect(wrongTeam[0]?.message).toMatch(/isn't a member of Test Team$/);
    expect(withTeam(wrestler(0))).toEqual([]);
  });

  it('reports a crew member, beat speaker or storyline that points at nothing', () => {
    expect(
      codesFor({ ...sound, crew: { refereeId: GHOST_PERSON, producerId: null, announcerIds: [] } }),
    ).toEqual(['unknownPerson']);
    expect(
      codesFor(
        angle(
          'angle.promo',
          [speaker(wrestler(2), 0)],
          [{ beatKey: 'beat.promo', personIds: [GHOST_PERSON] }],
        ),
      ),
    ).toEqual(['unknownPerson']);
    expect(codesFor({ ...sound, storylineIds: [GHOST_STORYLINE] })).toEqual(['unknownStoryline']);
  });

  it('reports a match with too few sides and a winner with no competitor', () => {
    expect(
      codesFor({
        ...sound,
        participants: [
          competitor(wrestler(2), 0),
          { ...competitor(wrestler(3), 1), role: 'ringside' },
        ],
      }),
    ).toEqual(['tooFewSides']);
    expect(
      problemsFor({ ...sound, outcome: { kind: 'win', winningSide: 4, methodKey: PINFALL } }),
    ).toEqual([
      expect.objectContaining({
        code: 'winnerWithoutCompetitor',
        message: "Side 5 has nobody wrestling, so it can't win",
      }),
    ]);
  });

  it("reports another promotion's title and a retired title by name", () => {
    const withTitles = (titleIds: TitleId[]) =>
      problemsFor({ ...sound, match: { ...sound.match, titleIds } });
    expect(withTitles([booking.ourTitle])).toEqual([]);
    expect(withTitles([booking.theirTitle])).toEqual([
      expect.objectContaining({
        code: 'titleNotOurs',
        message: "The Test Rival Title isn't one of this promotion's titles",
      }),
    ]);
    expect(withTitles([booking.retiredTitle])).toEqual([
      expect.objectContaining({
        code: 'titleRetired',
        message: 'The Old Crown has been retired',
      }),
    ]);
    expect(withTitles([GHOST_TITLE]).map((problem) => problem.code)).toEqual(['titleNotOurs']);
  });

  it('allows a hidden match type or method only on the segment that already uses it', () => {
    const hidden: Catalogs = structuredClone(TEST_CATALOGS);
    only(hidden.matchTypes?.[key('match.singles')], 'singles').hidden = true;
    only(hidden.methods?.[PINFALL], 'pinfall').hidden = true;
    const hiddenBooking = bookingWorld({ catalogs: hidden, existingMatch: true });
    const hiddenInstance = hiddenBooking.world.tables.eventInstances.require(hiddenBooking.show);
    const old = only(cardSegments(hiddenBooking.world, hiddenBooking.show)[0], 'existing match');
    const planned = singles(person(hiddenBooking, 0), person(hiddenBooking, 1), {
      kind: 'win',
      winningSide: 1,
      methodKey: PINFALL,
    });
    const check = (target: CardTarget) =>
      structuralProblems(hiddenBooking.world, {
        instance: hiddenInstance,
        draft: planned,
        target,
      }).map((problem) => problem.code);
    expect(check({ preShow: false, slot: 0, segmentId: old.id })).toEqual([]);
    expect(check(fresh)).toEqual(['unknownMatchType', 'unknownMethod']);
  });
});

describe('writes that break a rule', () => {
  it('throw CardWriteError and write nothing, even when the caller carries on', () => {
    const booking = bookingWorld({ existingMatch: true });
    const { world, show } = booking;
    const snapshot = () => ({
      segments: world.tables.segments.values(),
      participants: world.tables.participants.values(),
    });
    const before = snapshot();
    const result = world.transact('carry on', (tx) => {
      try {
        writeSegment(tx, {
          eventInstanceId: show,
          preShow: false,
          slot: 0,
          draft: singles(person(booking, 4), person(booking, 5)),
        });
      } catch (error: unknown) {
        return error instanceof CardWriteError ? error.reasons.map((reason) => reason.code) : [];
      }
      return [];
    });
    expect(result.ok && result.value).toEqual(['slotTaken']);
    expect(snapshot()).toEqual(before);
  });

  it('roll the whole step back when the caller lets the throw through', () => {
    const booking = bookingWorld();
    const { world, show } = booking;
    const codes = refusedCodes(world, (tx) => {
      writeSegment(tx, {
        eventInstanceId: show,
        preShow: false,
        slot: 0,
        draft: singles(person(booking, 0), person(booking, 1)),
      });
      writeSegment(tx, {
        eventInstanceId: show,
        preShow: false,
        slot: 9,
        draft: singles(person(booking, 2), person(booking, 3)),
      });
    });
    expect(codes).toEqual(['slotOutsideFormat']);
    expect(hasCard(world, show)).toBe(false);
    expect(world.tables.participants.ids()).toHaveLength(0);
  });
});
