// Show night's aftermath applier (MTCH3-03): popularity and momentum through the doors, one stored
// row per competitor, accumulation across a card, and never morale.
// Design: docs/design/match-aftermath.md#applying-an-aftermath
import { afterEach, describe, expect, it } from 'vitest';
import type { PersonId, RegionId, SegmentId } from '../../../../src/core/ids';
import { refKey } from '../../../../src/core/trace/store';
import type { Aftermath } from '../../../../src/model/entities/aftermath';
import type { GameWorld } from '../../../../src/model/tables';
import {
  computeSegmentAftermath,
  popularityGainTraceRef,
  momentumGainTraceRef,
  registerPopularityReach,
} from '../../../../src/systems/match';
import { createEngineTunables } from '../../../../src/systems/tunables';
import { geographyOf } from '../../../../src/systems/world/geography';
import {
  aftermathWorld,
  applyInOrder,
  NORTH_1,
  NORTH_2,
  SOUTH_1,
  SOUTH_2,
  type AftermathWorld,
} from './fixtures';

const unregister: (() => void)[] = [];
afterEach(() => {
  for (const undo of unregister.splice(0)) {
    undo();
  }
});

function popularityOf(world: GameWorld, personId: PersonId, regionId: RegionId): number {
  return world.tables.people.require(personId).regionalPop[regionId] ?? 0;
}

function rowFor(world: GameWorld, segmentId: SegmentId, personId: PersonId): Aftermath {
  const row = world.tables.aftermaths
    .lookup('bySegment', segmentId)
    .find((entry) => entry.personId === personId);
  if (row === undefined) {
    throw new Error(`no aftermath row for ${personId} in ${segmentId}`);
  }
  return row;
}

function regionOf(row: Aftermath, regionId: RegionId): { before: number; after: number } {
  const values = row.popularity.byRegion[regionId];
  if (values === undefined) {
    throw new Error(`row ${row.id} did not reach ${regionId}`);
  }
  return values;
}

/** The less popular worker (30) beats the more popular one (60) in North 2; 2 is at ringside. */
function singlesWorld(): AftermathWorld {
  return aftermathWorld({
    popularity: [30, 60, 40],
    matches: [{ slot: 0, sides: [[0], [1]], result: 0, ringside: [{ person: 2, side: 0 }] }],
  });
}

describe('applySegmentAftermath: a singles match', () => {
  it('lifts the winner most in the show region, by delta × spill next door, and drops the loser a little', () => {
    const built = singlesWorld();
    const { world } = built;
    const run = applyInOrder(world, [built.segment(0)]);
    expect(run.results).toEqual([{ personIds: [built.person(0), built.person(1)] }]);

    const winner = rowFor(world, built.segment(0), built.person(0));
    expect(winner.outcome).toBe('win');
    const delta = winner.popularity.delta;
    expect(delta).toBeGreaterThan(0);
    const show = regionOf(winner, NORTH_2);
    const north = regionOf(winner, NORTH_1);
    const south = regionOf(winner, SOUTH_1);
    expect(show.after - show.before).toBeCloseTo(delta, 2);
    // The neighbours get delta × neighbourSpill (0.4) before the taper; at charisma 90 there is none.
    expect(north.after - north.before).toBeCloseTo(delta * 0.4, 2);
    expect(south.after - south.before).toBeCloseTo(delta * 0.4, 2);
    expect(show.after - show.before).toBeGreaterThan(north.after - north.before);
    // South 2 is not next to North 2: untouched and not stored.
    expect(winner.popularity.byRegion[SOUTH_2]).toBeUndefined();
    expect(popularityOf(world, built.person(0), SOUTH_2)).toBe(30);
    expect(popularityOf(world, built.person(0), NORTH_2)).toBe(show.after);

    const loser = rowFor(world, built.segment(0), built.person(1));
    expect(loser.outcome).toBe('loss');
    const lost = regionOf(loser, NORTH_2);
    expect(lost.after - lost.before).toBeLessThan(0);
    expect(lost.after - lost.before).toBeGreaterThan(
      -createEngineTunables().get('match.popularity.maxLoss'),
    );
    expect(popularityOf(world, built.person(1), NORTH_2)).toBe(lost.after);
  });

  it('moves momentum through the door and records both gain traces', () => {
    const built = singlesWorld();
    const { world } = built;
    const run = applyInOrder(world, [built.segment(0)]);
    const winner = rowFor(world, built.segment(0), built.person(0));
    expect(winner.momentum).toEqual({
      employmentId: built.employment(0),
      before: 0,
      after: world.tables.employments.require(built.employment(0)).momentum,
    });
    expect(winner.momentum?.after).toBeGreaterThan(0);
    const loser = rowFor(world, built.segment(0), built.person(1));
    expect(loser.momentum?.after).toBeLessThan(0);

    const popularityRef = popularityGainTraceRef(built.segment(0), built.person(0));
    const momentumRef = momentumGainTraceRef(built.segment(0), built.person(0));
    expect(winner.traceIds).toEqual({
      popularity: refKey(popularityRef),
      momentum: refKey(momentumRef),
    });
    expect(run.traces.get(refKey(popularityRef))?.value).toBe(winner.popularity.delta);
    expect(run.traces.has(refKey(momentumRef))).toBe(true);
    expect(run.events.map((event) => event.type).sort()).toEqual([
      'momentum.changed',
      'momentum.changed',
      'popularity.changed',
      'popularity.changed',
    ]);
  });

  it('writes nothing for someone at ringside', () => {
    const built = singlesWorld();
    applyInOrder(built.world, [built.segment(0)]);
    expect(built.world.tables.aftermaths.lookup('byPerson', built.person(2))).toEqual([]);
    expect(popularityOf(built.world, built.person(2), NORTH_2)).toBe(40);
  });

  it('never changes morale and publishes no morale event', () => {
    const built = singlesWorld();
    const moraleBefore = [0, 1, 2].map(
      (index) => built.world.tables.employments.require(built.employment(index)).morale,
    );
    const run = applyInOrder(built.world, [built.segment(0)]);
    expect(
      [0, 1, 2].map(
        (index) => built.world.tables.employments.require(built.employment(index)).morale,
      ),
    ).toEqual(moraleBefore);
    expect(run.events.filter((event) => event.type === 'morale.changed')).toEqual([]);
  });
});

describe('applySegmentAftermath: two matches on one card', () => {
  const card = {
    popularity: [30, 60, 40, 45],
    matches: [
      // Slot 1: worker 0 wins a singles match. Slot 3: worker 0 and 2 lose a tag match.
      { slot: 0, sides: [[0], [1]], result: 0 },
      {
        slot: 2,
        sides: [
          [0, 2],
          [3, 1],
        ],
        result: 1,
      },
    ],
  } as const;

  it('stacks the second change on the values the first one left', () => {
    const built = aftermathWorld(card);
    const { world } = built;
    applyInOrder(world, [built.segment(0), built.segment(1)]);
    const first = rowFor(world, built.segment(0), built.person(0));
    const second = rowFor(world, built.segment(1), built.person(0));
    expect(world.tables.aftermaths.lookup('byPerson', built.person(0))).toHaveLength(2);
    expect(second.outcome).toBe('loss');
    expect(regionOf(second, NORTH_2).before).toBe(regionOf(first, NORTH_2).after);
    expect(second.momentum?.before).toBe(first.momentum?.after);
    expect(popularityOf(world, built.person(0), NORTH_2)).toBe(regionOf(second, NORTH_2).after);
  });

  it('ends where applying the two matches one after the other ends', () => {
    const together = aftermathWorld(card);
    applyInOrder(together.world, [together.segment(0), together.segment(1)]);
    const apart = aftermathWorld(card);
    applyInOrder(apart.world, [apart.segment(0)]);
    applyInOrder(apart.world, [apart.segment(1)]);
    for (const index of [0, 1, 2, 3]) {
      expect(apart.world.tables.people.require(apart.person(index)).regionalPop).toEqual(
        together.world.tables.people.require(together.person(index)).regionalPop,
      );
      expect(apart.world.tables.employments.require(apart.employment(index)).momentum).toBe(
        together.world.tables.employments.require(together.employment(index)).momentum,
      );
    }
  });

  it('measures tag partners against the values before the match, not each other’s gain', () => {
    const built = aftermathWorld(card);
    const before = computeSegmentAftermath(
      built.world,
      { segmentId: built.segment(1) },
      createEngineTunables(),
      geographyOf(built.world),
    );
    applyInOrder(built.world, [built.segment(1)]);
    for (const worker of before.workers) {
      expect(rowFor(built.world, built.segment(1), worker.personId).popularity.delta).toBe(
        worker.popularity.delta.value,
      );
    }
  });
});

describe('applySegmentAftermath: special cases', () => {
  it('moves the popularity of a worker with no contract and stores no momentum', () => {
    const built = aftermathWorld({
      popularity: [50],
      freeAgentPopularity: 40,
      matches: [{ slot: 0, sides: [[1], [0]], result: 0 }],
    });
    const run = applyInOrder(built.world, [built.segment(0)]);
    const row = rowFor(built.world, built.segment(0), built.person(1));
    expect(row.momentum).toBeNull();
    expect(row.traceIds.momentum).toBeNull();
    expect(regionOf(row, NORTH_2).after).toBeGreaterThan(40);
    expect(run.events.filter((event) => event.type === 'momentum.changed')).toHaveLength(1);
  });

  it('writes nothing and publishes nothing for a no contest', () => {
    const built = aftermathWorld({
      popularity: [30, 60],
      matches: [{ slot: 0, sides: [[0], [1]], result: 'noContest' }],
    });
    const people = built.world.tables.people.values();
    const employments = built.world.tables.employments.values();
    const run = applyInOrder(built.world, [built.segment(0)]);
    expect(run.results).toEqual([{ personIds: [] }]);
    expect(run.events).toEqual([]);
    expect(run.traces.size).toBe(0);
    expect(built.world.tables.aftermaths.size).toBe(0);
    expect(built.world.tables.people.values()).toEqual(people);
    expect(built.world.tables.employments.values()).toEqual(employments);
  });

  it('spreads to a region a reach provider adds, with its reason', () => {
    unregister.push(
      registerPopularityReach({
        id: 'test.farReach',
        order: 0,
        regionsFor: () => [{ regionId: SOUTH_2, weight: 0.25, reason: 'TV reach: Test Network' }],
      }),
    );
    const built = aftermathWorld({
      popularity: [30, 60],
      showRegion: NORTH_1,
      matches: [{ slot: 0, sides: [[0], [1]], result: 0 }],
    });
    const preview = computeSegmentAftermath(
      built.world,
      { segmentId: built.segment(0) },
      createEngineTunables(),
      geographyOf(built.world),
    );
    expect(preview.weights).toContainEqual(
      expect.objectContaining({
        regionId: SOUTH_2,
        weight: 0.25,
        source: 'test.farReach',
        reason: 'TV reach: Test Network',
      }),
    );
    applyInOrder(built.world, [built.segment(0)]);
    const winner = rowFor(built.world, built.segment(0), built.person(0));
    const far = regionOf(winner, SOUTH_2);
    expect(far.after - far.before).toBeCloseTo(winner.popularity.delta * 0.25, 2);
    // South 1 is neither the show region, a neighbour of North 1, nor reached.
    expect(winner.popularity.byRegion[SOUTH_1]).toBeUndefined();
  });

  it('gives a region reached as a neighbour and by a provider the larger weight', () => {
    unregister.push(
      registerPopularityReach({
        id: 'test.nearReach',
        order: 0,
        regionsFor: () => [{ regionId: NORTH_2, weight: 0.7, reason: 'TV reach: Test Network' }],
      }),
    );
    const built = aftermathWorld({
      popularity: [30, 60],
      showRegion: NORTH_1,
      matches: [{ slot: 0, sides: [[0], [1]], result: 0 }],
    });
    applyInOrder(built.world, [built.segment(0)]);
    const winner = rowFor(built.world, built.segment(0), built.person(0));
    const near = regionOf(winner, NORTH_2);
    expect(near.after - near.before).toBeCloseTo(winner.popularity.delta * 0.7, 2);
  });
});
