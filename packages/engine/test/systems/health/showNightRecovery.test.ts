// WRK6-07: the player's show runs before its day (Run the show), a rival's inside it; either way
// the workers rest from the show the next morning. Design: docs/design/health.md#the-players-show-nights
import { describe, expect, it } from 'vitest';
import { createEngine, initialEngineState, type Engine } from '../../../src/core/api';
import { addDays } from '../../../src/core/date';
import type { PersonId } from '../../../src/core/ids';
import type { BodyCondition } from '../../../src/model/entities/person';
import { defaultSystems } from '../../../src/systems';
import {
  angle,
  book,
  bookRunnable,
  change,
  match,
  PLAYER_ONE,
  START,
  validateWorld,
  who,
} from '../booking/validate-world';

interface Body {
  readonly fatigue: number;
  readonly condition: BodyCondition;
}

function bodyOf(engine: Engine, personId: PersonId): Body {
  const person = engine
    .exportState()
    .world.tables.people.find((candidate) => candidate.id === personId);
  if (person === undefined) {
    throw new Error(`No person ${personId}`);
  }
  return { fatigue: person.fatigue, condition: person.condition };
}

/**
 * Monday 5 January 2026: the player's show (Mia Torres v Leo Hart opens it) and, on the same day,
 * a show of Brand Two, now run by the computer, with the same match between two others.
 */
function sameMatchTwoShows() {
  const built = validateWorld();
  const card = bookRunnable(built);
  change(built, (tx) => {
    tx.update('brands', built.brandTwo, { controller: { kind: 'computer' } });
    // Already booked, so the computer runs this card rather than planning its own.
    tx.update('eventInstances', built.rival, { date: START, airDate: START, status: 'booked' });
  });
  book(built, 0, match([[who(built, 1)], [who(built, 2)]]), { show: built.rival });
  return { built, card, mine: who(built, 6), rivals: who(built, 1) };
}

describe('show night recovery', () => {
  it("rests the player's and a rival's worker from the same match on the same morning", async () => {
    const { built, mine, rivals } = sameMatchTwoShows();
    const engine = createEngine({
      state: initialEngineState(built.world),
      systems: defaultSystems,
    });
    expect(bodyOf(engine, mine).fatigue).toBe(0);
    expect(bodyOf(engine, rivals).fatigue).toBe(0);

    // The player runs their show before the day starts.
    const ran = engine.command('shows.runTonight', { eventInstanceId: built.show }, PLAYER_ONE);
    expect(ran.ok).toBe(true);
    const afterMyShow = bodyOf(engine, mine);
    expect(afterMyShow.fatigue).toBeGreaterThan(0);

    // The show day itself (a Monday, so body condition heals too): the rival show runs at night.
    // Nobody rests from tonight's shows yet, the player's workers included.
    expect((await engine.advanceDays({ maxDays: 1 })).daysAdvanced).toBe(1);
    expect(engine.exportState().world.meta.currentDate).toBe(addDays(START, 1));
    expect(bodyOf(engine, mine)).toEqual(afterMyShow);
    const rivalAfterShow = bodyOf(engine, rivals);
    expect(rivalAfterShow.fatigue).toBeGreaterThan(0);

    // The next morning both rest.
    expect((await engine.advanceDays({ maxDays: 1 })).daysAdvanced).toBe(1);
    expect(bodyOf(engine, mine).fatigue).toBeLessThan(afterMyShow.fatigue);
    expect(bodyOf(engine, rivals).fatigue).toBeLessThan(rivalAfterShow.fatigue);
  });

  it('runs the morning once when the player runs two shows on one day', () => {
    const { built, mine } = sameMatchTwoShows();
    // Brand Two back to the second player, so both shows of the day are run by command.
    change(built, (tx) => {
      tx.update('brands', built.brandTwo, {
        controller: { kind: 'human', playerId: 'player-2' },
      });
      for (const person of built.world.tables.people.values()) {
        tx.update('people', person.id, { fatigue: 40 });
      }
    });
    book(built, 2, angle([who(built, 11)]), { show: built.rival });
    book(built, 5, match([[who(built, 0)], [who(built, 7)]]), { show: built.rival });
    const engine = createEngine({
      state: initialEngineState(built.world),
      systems: defaultSystems,
    });
    expect(engine.command('shows.runTonight', { eventInstanceId: built.show }, PLAYER_ONE).ok).toBe(
      true,
    );
    const afterFirst = bodyOf(engine, mine);
    // Mia Torres rested once (below 40) and wrestled (above what the rest left).
    expect(
      engine.command(
        'shows.runTonight',
        { eventInstanceId: built.rival },
        { kind: 'human', playerId: 'player-2' },
      ).ok,
    ).toBe(true);
    // The second show's morning did not rest her again.
    expect(bodyOf(engine, mine)).toEqual(afterFirst);
  });
});
