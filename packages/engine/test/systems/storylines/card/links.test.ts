// Storyline links on segments (CRTV4-01). Design: docs/design/storylines.md#linking
import { describe, expect, it } from 'vitest';
import {
  controllerViewer,
  createEngine,
  initialEngineState,
  type Engine,
} from '../../../../src/core/api';
import type { CommandResult, QueryResult } from '../../../../src/core/api/result';
import type { PersonId, SegmentId, StorylineId } from '../../../../src/core/ids';
import type { Controller } from '../../../../src/model/controller';
import type { Storyline } from '../../../../src/model/entities/storyline';
import { checkWorld } from '../../../../src/model/integrity';
import { TABLES, type GameWorld } from '../../../../src/model/tables';
import { documentToWorld } from '../../../../src/persistence/world-document';
import { defaultSystems } from '../../../../src/systems';
import { draftFromSegment } from '../../../../src/systems/booking';
import {
  membersInSegment,
  STORYLINE_LINK_WARNINGS,
  type StorylineLinkOptions,
} from '../../../../src/systems/storylines';
import { expectSerialisable } from '../../../support/trace';
import { COMPUTER, PLAYER_ONE, PLAYER_TWO } from '../../calendar/lifecycle-world';
import { commandWorld, promo, seed, singles, wrestler } from '../../booking/command-world';

type StorylineFields = Omit<Storyline, 'id' | 'promotionId'> & {
  promotionId?: Storyline['promotionId'];
};

/**
 * The booking command world (promotion A run by player 1) with storylines and a card on its open
 * show: `twoHere` (roster 0 and 1, heat 40), `oneHere` (roster 0 and 5, heat 90), `nobodyHere`
 * (roster 6 and 7), `ended`, `branded` (on Test Brand Two, which the open show is not) and
 * promotion B's `rival`. The open show has `match` (roster 0 v 1, slot 0), `angle` (a promo by
 * roster 2, slot 1) and `other` (roster 3 v 4, slot 2); the completed show has `played` (roster 0 v
 * 1).
 */
function linkWorld() {
  const booked = commandWorld();
  const { world } = booked;
  const person = (index: number): PersonId => wrestler(booked, index);
  const promotionA = world.tables.promotions.values().find((row) => row.name.endsWith(' A'))!;
  const promotionB = world.tables.promotions.values().find((row) => row.name.endsWith(' B'))!;
  const brandTwo = world.tables.brands.values().find((row) => row.name === 'Test Brand Two')!;
  const base = (
    name: string,
    heat: number,
    members: readonly PersonId[],
    extra: Partial<StorylineFields> = {},
  ): Omit<Storyline, 'id'> => ({
    promotionId: promotionA.id,
    brandId: null,
    name,
    status: 'active',
    startedOn: world.meta.startDate,
    endedOn: null,
    heat,
    members: members.map((personId, index) => ({
      personId,
      side: index === 0 ? 'face' : 'heel',
    })),
    summary: '',
    lastProgressOn: null,
    finaleSegmentId: null,
    progress: [],
    progressTotals: { segments: 0, matches: 0, angles: 0, heatGained: 0, heatLost: 0 },
    payoff: null,
    ...extra,
  });
  const made = world.transact('storylines', (tx) => {
    const add = (row: Omit<Storyline, 'id'>): StorylineId => tx.create('storylines', row).id;
    return {
      twoHere: add(base('Test Two Here', 40, [person(0), person(1)])),
      oneHere: add(base('Test One Here', 90, [person(0), person(5)])),
      nobodyHere: add(base('Test Nobody Here', 50, [person(6), person(7)])),
      ended: add(
        base('Test Ended', 60, [person(0)], { status: 'ended', endedOn: world.meta.startDate }),
      ),
      branded: add(base('Test Branded', 60, [person(1)], { brandId: brandTwo.id })),
      rival: add(base('Test Rival', 70, [booked.rivals[0]!], { promotionId: promotionB.id })),
    };
  });
  if (!made.ok) throw made.error;
  const storylines = made.value;
  const open = booked.shows.open;
  const match = seed(world, open, 0, singles(person(0), person(1)));
  const angle = seed(world, open, 1, promo(person(2)));
  const other = seed(world, open, 2, singles(person(3), person(4)));
  const played = seed(world, booked.shows.completed, 0, singles(person(0), person(1)));
  const engine = createEngine({ state: initialEngineState(world), systems: defaultSystems });
  return { ...booked, storylines, match, angle, other, played, engine, person };
}

type LinkWorld = ReturnType<typeof linkWorld>;

function applied<T>(result: CommandResult<T> | QueryResult<T>): T {
  if (!result.ok) {
    throw new Error(`refused: ${JSON.stringify(result.reasons)}`);
  }
  expectSerialisable(result.data);
  return result.data;
}

function codes<T>(result: CommandResult<T>): string[] {
  return result.ok ? [] : result.reasons.map((reason) => reason.code);
}

function options(built: LinkWorld, segmentId: SegmentId, controller = PLAYER_ONE) {
  return applied(
    built.engine.query('storylines.linkOptions', { segmentId }, controllerViewer(controller)),
  );
}

function okOptions(built: LinkWorld, segmentId: SegmentId) {
  const result: StorylineLinkOptions = options(built, segmentId);
  if (result.kind !== 'ok') throw new Error(`unavailable: ${JSON.stringify(result.reason)}`);
  return result;
}

function link(
  built: LinkWorld,
  segmentId: SegmentId,
  storylineIds: StorylineId[],
  issuedBy: Controller = PLAYER_ONE,
) {
  return built.engine.command('storylines.linkSegment', { segmentId, storylineIds }, issuedBy);
}

function setFinale(
  built: LinkWorld,
  storylineId: StorylineId,
  segmentId: SegmentId | null,
  issuedBy: Controller = PLAYER_ONE,
) {
  return built.engine.command('storylines.setFinale', { storylineId, segmentId }, issuedBy);
}

function worldOf(engine: Engine): GameWorld {
  return documentToWorld({ state: { world: engine.exportState().world } }, TABLES);
}

function storylineIn(engine: Engine, id: StorylineId): Storyline {
  return worldOf(engine).tables.storylines.require(id);
}

function linksOf(engine: Engine, segmentId: SegmentId): readonly StorylineId[] {
  return worldOf(engine).tables.segments.require(segmentId).storylineIds;
}

function integrityIssues(engine: Engine): string[] {
  return checkWorld(worldOf(engine), TABLES, { validateRows: true }).issues.map(
    (issue) => `${issue.code} ${issue.message}`,
  );
}

describe('membersInSegment', () => {
  it('lists the storyline members in the segment, id-sorted', () => {
    const built = linkWorld();
    const read = worldOf(built.engine);
    expect(membersInSegment(read, built.storylines.twoHere, built.match)).toEqual(
      [built.person(0), built.person(1)].sort(),
    );
    expect(membersInSegment(read, built.storylines.oneHere, built.match)).toEqual([
      built.person(0),
    ]);
    expect(membersInSegment(read, built.storylines.nobodyHere, built.match)).toEqual([]);
  });
});

describe('storylines.linkOptions', () => {
  it('suggests storylines with members in the segment, most members first, then the rest', () => {
    const built = linkWorld();
    const view = okOptions(built, built.match);
    expect(view.suggestions.map((row) => row.name)).toEqual(['Test Two Here', 'Test One Here']);
    expect(view.suggestions[0]?.membersHere).toHaveLength(2);
    // Ended, other-brand and rival storylines are not offered at all.
    expect(view.others.map((row) => row.name)).toEqual(['Test Nobody Here']);
    expect(view).toMatchObject({ linked: [], canSetFinale: true, maxLinks: 2, locked: false });
  });

  it('shows linked storylines with their finale, and no finale for a talking segment', () => {
    const built = linkWorld();
    applied(link(built, built.match, [built.storylines.twoHere]));
    applied(link(built, built.other, [built.storylines.twoHere]));
    applied(setFinale(built, built.storylines.twoHere, built.other));
    const view = okOptions(built, built.match);
    expect(view.linked).toEqual([
      {
        storylineId: built.storylines.twoHere,
        name: 'Test Two Here',
        heat: 40,
        active: true,
        membersHere: [built.person(0), built.person(1)].sort(),
        isFinale: false,
        finaleElsewhere: {
          segmentId: built.other,
          eventInstanceId: built.shows.open,
          showName: 'Test Open Show',
          slot: 'Slot 3',
        },
      },
    ]);
    expect(view.suggestions.map((row) => row.name)).toEqual(['Test One Here']);
    expect(okOptions(built, built.other).linked[0]?.isFinale).toBe(true);
    expect(okOptions(built, built.angle).canSetFinale).toBe(false);
  });

  it("is unavailable for a show the viewer doesn't run", () => {
    const built = linkWorld();
    expect(options(built, built.match, PLAYER_TWO)).toMatchObject({
      kind: 'unavailable',
      reason: { code: 'notYourShow' },
    });
  });

  it('says a completed show is locked', () => {
    const built = linkWorld();
    expect(okOptions(built, built.played)).toMatchObject({ locked: true, canSetFinale: false });
  });
});

describe('storylines.linkSegment', () => {
  it('links up to the limit and refuses one more with tooManyLinks', () => {
    const built = linkWorld();
    const { twoHere, oneHere, nobodyHere } = built.storylines;
    expect(applied(link(built, built.match, [twoHere, oneHere]))).toEqual({
      storylineIds: [twoHere, oneHere],
    });
    expect(linksOf(built.engine, built.match)).toEqual([twoHere, oneHere]);
    const refused = link(built, built.match, [twoHere, oneHere, nobodyHere]);
    expect(codes(refused)).toEqual(['storylines.tooManyLinks']);
    expect(refused.ok ? '' : refused.reasons[0]?.message).toContain('2');
    expect(linksOf(built.engine, built.match)).toEqual([twoHere, oneHere]);
  });

  it('allows linking a segment where no member appears (the booking check warns)', () => {
    const built = linkWorld();
    applied(link(built, built.other, [built.storylines.twoHere]));
    const validation = applied(
      built.engine.query(
        'booking.validate',
        { eventInstanceId: built.shows.open },
        controllerViewer(PLAYER_ONE),
      ),
    );
    const mine = validation.warnings.filter((issue) => issue.checkId === 'storylines.links');
    expect(mine).toEqual([
      expect.objectContaining({
        code: STORYLINE_LINK_WARNINGS.noMemberInSegment,
        segmentId: built.other,
        message: expect.stringContaining(
          "'Test Two Here' but none of its members is in it",
        ) as unknown,
      }),
    ]);
    expect(validation.errors.filter((issue) => issue.checkId === 'storylines.links')).toEqual([]);
  });

  it('warns about a link to a storyline that has ended since', () => {
    const built = linkWorld();
    applied(link(built, built.match, [built.storylines.twoHere]));
    applied(
      built.engine.command('storylines.end', { storylineId: built.storylines.twoHere }, PLAYER_ONE),
    );
    const validation = applied(
      built.engine.query(
        'booking.validate',
        { eventInstanceId: built.shows.open },
        controllerViewer(PLAYER_ONE),
      ),
    );
    expect(validation.warnings).toContainEqual(
      expect.objectContaining({
        code: STORYLINE_LINK_WARNINGS.linkedStorylineEnded,
        message: "'Test Two Here' has ended: this link won't count",
      }),
    );
    // Keeping the old link while adding another is fine; it just won't count.
    applied(link(built, built.match, [built.storylines.twoHere, built.storylines.oneHere]));
  });

  it('refuses rival, other-brand and ended storylines, and a show that has run', () => {
    const built = linkWorld();
    expect(codes(link(built, built.match, [built.storylines.rival]))).toEqual([
      'storylines.otherPromotion',
    ]);
    expect(codes(link(built, built.match, [built.storylines.branded]))).toEqual([
      'storylines.brandMismatch',
    ]);
    expect(codes(link(built, built.match, [built.storylines.ended]))).toEqual([
      'storylines.storylineEnded',
    ]);
    expect(codes(link(built, built.played, [built.storylines.twoHere]))).toEqual(['showCompleted']);
  });

  it('refuses the computer, and another player, on your show', () => {
    const built = linkWorld();
    expect(codes(link(built, built.match, [built.storylines.twoHere], COMPUTER))).toEqual([
      'notYourShow',
    ]);
    expect(codes(link(built, built.match, [built.storylines.twoHere], PLAYER_TWO))).toEqual([
      'notYourShow',
    ]);
  });

  it('clears the finale when its storyline is unlinked', () => {
    const built = linkWorld();
    const { twoHere, oneHere } = built.storylines;
    applied(link(built, built.match, [twoHere, oneHere]));
    applied(setFinale(built, twoHere, built.match));
    expect(storylineIn(built.engine, twoHere).finaleSegmentId).toBe(built.match);
    applied(link(built, built.match, [oneHere]));
    expect(storylineIn(built.engine, twoHere).finaleSegmentId).toBeNull();
    expect(integrityIssues(built.engine)).toEqual([]);
  });
});

describe('storylines.setFinale', () => {
  it('refuses a talking segment and an unlinked match', () => {
    const built = linkWorld();
    const { twoHere } = built.storylines;
    applied(link(built, built.angle, [twoHere]));
    expect(codes(setFinale(built, twoHere, built.angle))).toEqual(['storylines.notAMatch']);
    expect(codes(setFinale(built, twoHere, built.match))).toEqual(['storylines.notLinked']);
  });

  it('moves the finale between two unplayed matches, and clears it with null', () => {
    const built = linkWorld();
    const { twoHere } = built.storylines;
    applied(link(built, built.match, [twoHere]));
    applied(link(built, built.other, [twoHere]));
    expect(applied(setFinale(built, twoHere, built.match))).toEqual({
      finaleSegmentId: built.match,
    });
    expect(applied(setFinale(built, twoHere, built.other))).toEqual({
      finaleSegmentId: built.other,
    });
    expect(storylineIn(built.engine, twoHere).finaleSegmentId).toBe(built.other);
    expect(applied(setFinale(built, twoHere, null))).toEqual({ finaleSegmentId: null });
    expect(storylineIn(built.engine, twoHere).finaleSegmentId).toBeNull();
    expect(integrityIssues(built.engine)).toEqual([]);
  });

  it('refuses to move a finale that has been played', () => {
    const built = linkWorld();
    const { twoHere } = built.storylines;
    const done = built.world.transact('played finale', (tx) => {
      tx.update('segments', built.played, { storylineIds: [twoHere] });
      tx.update('storylines', twoHere, { finaleSegmentId: built.played });
    });
    if (!done.ok) throw done.error;
    const engine = createEngine({
      state: initialEngineState(built.world),
      systems: defaultSystems,
    });
    const moved = { ...built, engine };
    applied(link(moved, built.match, [twoHere]));
    expect(codes(setFinale(moved, twoHere, built.match))).toEqual([
      'storylines.finaleAlreadyPlayed',
    ]);
    expect(codes(setFinale(moved, twoHere, null))).toEqual(['storylines.finaleAlreadyPlayed']);
  });

  it("refuses the computer and another player's storyline", () => {
    const built = linkWorld();
    applied(link(built, built.match, [built.storylines.twoHere]));
    expect(codes(setFinale(built, built.storylines.twoHere, built.match, COMPUTER))).toEqual([
      'notYourShow',
    ]);
    expect(codes(setFinale(built, built.storylines.rival, null))).toEqual(['storylines.notYours']);
  });
});

describe('booking changes keep finales sound', () => {
  function withFinale() {
    const built = linkWorld();
    const { twoHere } = built.storylines;
    applied(link(built, built.match, [twoHere]));
    applied(setFinale(built, twoHere, built.match));
    return built;
  }

  it('clears the finale when its segment is removed', () => {
    const built = withFinale();
    applied(built.engine.command('booking.removeSegment', { segmentId: built.match }, PLAYER_ONE));
    expect(storylineIn(built.engine, built.storylines.twoHere).finaleSegmentId).toBeNull();
    expect(integrityIssues(built.engine)).toEqual([]);
  });

  it('clears the finale when the card is cleared', () => {
    const built = withFinale();
    applied(
      built.engine.command('booking.clearCard', { eventInstanceId: built.shows.open }, PLAYER_ONE),
    );
    expect(storylineIn(built.engine, built.storylines.twoHere).finaleSegmentId).toBeNull();
    expect(integrityIssues(built.engine)).toEqual([]);
  });

  it('clears the finale when the match becomes a talking segment, and keeps it on other edits', () => {
    const built = withFinale();
    const { twoHere } = built.storylines;
    const draft = draftFromSegment(worldOf(built.engine), built.match);
    applied(
      built.engine.command('booking.updateSegment', { segmentId: built.match, draft }, PLAYER_ONE),
    );
    expect(storylineIn(built.engine, twoHere).finaleSegmentId).toBe(built.match);
    const talking = { ...promo(built.person(0)), storylineIds: [twoHere] };
    applied(
      built.engine.command(
        'booking.updateSegment',
        { segmentId: built.match, draft: talking },
        PLAYER_ONE,
      ),
    );
    expect(storylineIn(built.engine, twoHere).finaleSegmentId).toBeNull();
    expect(integrityIssues(built.engine)).toEqual([]);
  });
});
