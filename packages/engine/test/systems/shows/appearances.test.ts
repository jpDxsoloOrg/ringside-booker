// Appearance counts on show night. Design: docs/design/show-night.md#appearances
import { describe, expect, it } from 'vitest';
import { createEngine, initialEngineState, type Engine } from '../../../src/core/api';
import { simSystem } from '../../../src/core/api/builtins';
import { matchesCadence } from '../../../src/core/calendar/cadence';
import { parseGameDate } from '../../../src/core/date';
import type { PersonId } from '../../../src/core/ids';
import type { GameWorld } from '../../../src/model/tables';
import { matchSystem } from '../../../src/systems/match';
import { resetAppearancesPhase, showsSystem } from '../../../src/systems/shows';
import { expectValidWorld } from '../../support';
import { seed } from '../booking/command-world';
import {
  TODAY,
  competitor,
  member,
  runNight,
  titleMatch,
  titleNightWorld,
  winFor,
} from './title-night-world';

function contractOf(world: GameWorld, personId: PersonId) {
  const employment = world.tables.employments.lookup('byPerson', personId)[0];
  if (employment === undefined) {
    throw new Error(`No contract for ${personId}`);
  }
  return employment;
}

/** An engine on `world` that runs show night (no calendar), so tests can advance it day by day. */
function nightEngine(world: GameWorld): Engine {
  return createEngine({
    state: initialEngineState(world),
    systems: [simSystem, matchSystem, showsSystem],
  });
}

async function advance(engine: Engine, days: number): Promise<void> {
  const advanced = await engine.advanceDays({ maxDays: days });
  expect(advanced.failures).toEqual([]);
}

/** A person's contract in the engine's current state. */
function contractIn(engine: Engine, personId: PersonId) {
  const employment = engine
    .exportState()
    .world.tables.employments.find((row) => row.personId === personId);
  if (employment === undefined) {
    throw new Error(`No contract for ${personId}`);
  }
  return employment;
}

describe('appearance counts', () => {
  it('counts every distinct worker on the card once, crew included, and skips guests', () => {
    const built = titleNightWorld();
    const [p0, p1, p2, p3, p4] = [0, 1, 2, 3, 4].map((index) => member(built, index));
    const guest = built.rivals[0];
    if (p0 === undefined || p1 === undefined || p2 === undefined || p3 === undefined) {
      throw new Error('roster too small');
    }
    if (p4 === undefined || guest === undefined) {
      throw new Error('roster too small');
    }
    const first = seed(
      built.world,
      built.show,
      0,
      titleMatch([competitor(p0, 0), competitor(p1, 1)], winFor(0), []),
    );
    const second = seed(
      built.world,
      built.show,
      1,
      titleMatch([competitor(p0, 0), competitor(p2, 1)], winFor(0), []),
    );
    const crewed = built.world.transact('add crew', (tx) => {
      tx.update('segments', first, {
        crew: { refereeId: p3, producerId: guest, announcerIds: [] },
      });
      tx.update('segments', second, {
        crew: { refereeId: p3, producerId: null, announcerIds: [p4] },
      });
    });
    expect(crewed.ok).toBe(true);
    runNight(built);

    for (const worker of [p0, p1, p2, p3, p4]) {
      expect(contractOf(built.world, worker)).toMatchObject({
        appearancesThisYear: 1,
        lastAppearanceOn: TODAY,
      });
    }
    for (const idle of [5, 6, 7].map((index) => member(built, index))) {
      expect(contractOf(built.world, idle).appearancesThisYear).toBe(0);
    }
    // The guest has no contract with promotion A; their own contract is untouched.
    expect(contractOf(built.world, guest).appearancesThisYear).toBe(0);
    expectValidWorld(built.world);
  });

  it('counts nothing for a show scored off-screen', () => {
    const built = titleNightWorld();
    runNight(built);
    for (const rival of built.rivals) {
      expect(contractOf(built.world, rival)).toMatchObject({
        appearancesThisYear: 0,
        lastAppearanceOn: null,
      });
    }
  });
});

describe('shows.resetAppearances', () => {
  it('is due on 1 January only', () => {
    const { cadence } = resetAppearancesPhase;
    expect(matchesCadence(parseGameDate('2027-01-01'), cadence)).toBe(true);
    expect(matchesCadence(parseGameDate('2026-12-31'), cadence)).toBe(false);
    expect(matchesCadence(parseGameDate('2028-02-29'), cadence)).toBe(false);
    expect(resetAppearancesPhase).toMatchObject({ group: 'housekeeping', order: 22 });
  });

  it('leaves the counts alone on 31 December and resets them on 1 January', async () => {
    const built = titleNightWorld({ today: parseGameDate('2026-12-31'), appearances: 5 });
    const person = member(built, 6);
    const lastSeen = parseGameDate('2026-12-20');
    const seen = built.world.transact('seen', (tx) => {
      tx.update('employments', contractOf(built.world, person).id, { lastAppearanceOn: lastSeen });
    });
    expect(seen.ok).toBe(true);

    const engine = nightEngine(built.world);
    await advance(engine, 1);
    expect(contractIn(engine, person).appearancesThisYear).toBe(5);
    await advance(engine, 1);
    expect(contractIn(engine, person)).toMatchObject({
      appearancesThisYear: 0,
      lastAppearanceOn: lastSeen,
    });
  });

  it('leaves the counts alone on 29 February', async () => {
    const built = titleNightWorld({ today: parseGameDate('2028-02-29'), appearances: 3 });
    const engine = nightEngine(built.world);
    await advance(engine, 1);
    expect(contractIn(engine, member(built, 6)).appearancesThisYear).toBe(3);
  });

  it('runs before the shows, so a 1 January show counts as the first of the new year', async () => {
    const newYear = parseGameDate('2027-01-01');
    const built = titleNightWorld({ today: newYear, appearances: 7 });
    seed(
      built.world,
      built.show,
      0,
      titleMatch([competitor(member(built, 0), 0), competitor(member(built, 1), 1)], winFor(0), []),
    );
    const engine = nightEngine(built.world);
    await advance(engine, 1);
    expect(contractIn(engine, member(built, 0))).toMatchObject({
      appearancesThisYear: 1,
      lastAppearanceOn: newYear,
    });
    expect(contractIn(engine, member(built, 6)).appearancesThisYear).toBe(0);
  });
});
