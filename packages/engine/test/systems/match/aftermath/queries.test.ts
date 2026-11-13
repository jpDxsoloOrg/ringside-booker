// The aftermath on read (MTCH3-03): `match.simulate`'s aftermath block, which never writes, and
// `match.aftermath`, the stored rows for results pages and Recent form.
// Design: docs/design/match-aftermath.md#the-aftermath-of-one-match
import { describe, expect, it } from 'vitest';
import {
  createEngine,
  defineSystem,
  initialEngineState,
  OMNISCIENT_VIEWER,
  type Engine,
  type Viewer,
} from '../../../../src/core/api';
import { simSystem } from '../../../../src/core/api/builtins';
import { parseContentKey } from '../../../../src/core/content-key';
import { definePhase } from '../../../../src/core/pipeline/phase';
import { defaultSystems } from '../../../../src/systems';
import {
  applySegmentAftermath,
  hasMomentum,
  matchSystem,
  momentumGainTraceRef,
  popularityGainTraceRef,
  type SimulateArgs,
} from '../../../../src/systems/match';
import { workersSystem } from '../../../../src/systems/workers';
import { TEST_PLAYER_ID } from '../../../support/builders/build-row';
import { testId } from '../../../support/ids';
import { expectSerialisable } from '../../../support/trace';
import { aftermathWorld, NORTH_1, NORTH_2, SOUTH_1 } from './fixtures';

const PLAYER: Viewer = {
  kind: 'controller',
  controller: { kind: 'human', playerId: TEST_PLAYER_ID },
};

function simulateEngine() {
  const built = aftermathWorld({ popularity: [30, 60, 40, 45], matches: [] });
  const engine = createEngine({
    state: initialEngineState(built.world),
    systems: defaultSystems,
  });
  const args: SimulateArgs = {
    kind: 'match',
    typeKey: parseContentKey('match.singles'),
    sides: [[built.person(0)], [built.person(1)]],
    slotRole: 'mainEvent',
    importance: 'major',
    regionId: NORTH_2,
    televised: true,
    previewSeed: 7,
    winner: { side: 0 },
    finishKey: null,
  };
  return { built, engine, args };
}

function simulate(engine: Engine, args: SimulateArgs) {
  const result = engine.query('match.simulate', args, PLAYER);
  if (!result.ok) {
    throw new Error(JSON.stringify(result.reasons));
  }
  return result.data;
}

describe('match.simulate: aftermath', () => {
  it('gives every competitor regions, roll-ups and momentum, each with a trace', () => {
    const { built, engine, args } = simulateEngine();
    const { aftermath } = simulate(engine, args);
    expectSerialisable(aftermath);
    expect(aftermath.segmentId).toBeNull();
    expect(aftermath.showRegionId).toBe(NORTH_2);
    expect(aftermath.workers.map((worker) => [worker.personId, worker.outcome])).toEqual([
      [built.person(0), 'win'],
      [built.person(1), 'loss'],
    ]);
    for (const worker of aftermath.workers) {
      expect(worker.popularity.regions.map((row) => [row.regionId, row.source])).toEqual([
        [NORTH_2, 'show'],
        [NORTH_1, 'neighbour'],
        [SOUTH_1, 'neighbour'],
      ]);
      for (const row of worker.popularity.regions) {
        expect(row.change).toBeCloseTo(row.after - row.before, 10);
        expect(row.trace).toBeDefined();
      }
      // North 2 and North 1 are in the north, South 1 in the south: both countries moved.
      expect(worker.popularity.countries).toHaveLength(2);
      expect(worker.popularity.continents).toHaveLength(1);
      for (const row of [...worker.popularity.countries, ...worker.popularity.continents]) {
        expect(row.change).toBeCloseTo(row.after - row.before, 10);
        expect(row.trace.kind).toBe('formula');
      }
      if (!hasMomentum(worker.momentum)) {
        throw new Error('both workers have a contract');
      }
      expect(worker.momentum.trace).toBeDefined();
    }
    const [winner, loser] = aftermath.workers;
    expect(winner?.popularity.delta.value).toBeGreaterThan(0);
    expect(loser?.popularity.delta.value).toBeLessThan(0);
    expect(winner?.resultLine).toBe(`Beat ${loser?.name ?? ''}`);
  });

  it('gives the same aftermath for the same arguments and seed', () => {
    const { engine, args } = simulateEngine();
    expect(JSON.stringify(simulate(engine, args).aftermath)).toBe(
      JSON.stringify(simulate(engine, args).aftermath),
    );
    const again = simulateEngine();
    expect(JSON.stringify(simulate(again.engine, again.args).aftermath)).toBe(
      JSON.stringify(simulate(engine, args).aftermath),
    );
  });

  it('never changes the world, however often it runs', () => {
    const { engine, args } = simulateEngine();
    const before = JSON.stringify(engine.exportState());
    for (let run = 0; run < 100; run += 1) {
      simulate(engine, { ...args, previewSeed: run });
    }
    expect(JSON.stringify(engine.exportState())).toBe(before);
  });

  it('shows a tag partner the values before the match', () => {
    const { built, engine, args } = simulateEngine();
    const { aftermath } = simulate(engine, {
      ...args,
      typeKey: parseContentKey('match.tag-team'),
      sides: [
        [built.person(0), built.person(2)],
        [built.person(1), built.person(3)],
      ],
    });
    expect(aftermath.workers).toHaveLength(4);
    const winners = aftermath.workers.filter((worker) => worker.outcome === 'win');
    for (const worker of winners) {
      expect(worker.popularity.regions[0]?.before).toBe(
        worker.personId === built.person(0) ? 30 : 40,
      );
    }
  });
});

describe('match.aftermath', () => {
  /** One show with two matches, applied by a phase on the first day so the traces are stored. */
  async function appliedEngine() {
    const built = aftermathWorld({
      popularity: [30, 60, 40, 45],
      freeAgentPopularity: 20,
      matches: [
        { slot: 1, sides: [[0], [1]], result: 0 },
        { slot: 0, sides: [[2], [4]], result: 'draw' },
      ],
    });
    const applier = defineSystem({
      id: 'aftermathTest',
      phases: [
        definePhase({
          id: 'aftermathTest.apply',
          group: 'housekeeping',
          order: 10,
          cadence: { kind: 'daily' },
          condition: (read) => read.tables.aftermaths.size === 0,
          run: (ctx) => {
            applySegmentAftermath(ctx, built.segment(1));
            applySegmentAftermath(ctx, built.segment(0));
          },
        }),
      ],
    });
    const engine = createEngine({
      state: initialEngineState(built.world),
      systems: [simSystem, workersSystem, matchSystem, applier],
    });
    const advance = await engine.advanceDays({ maxDays: 1 });
    expect(advance.failures).toEqual([]);
    return { built, engine };
  }

  it('groups a show’s rows by match in card order, with names and trace refs', async () => {
    const { built, engine } = await appliedEngine();
    const result = engine.query(
      'match.aftermath',
      { eventInstanceId: built.show },
      OMNISCIENT_VIEWER,
    );
    if (!result.ok) {
      throw new Error(JSON.stringify(result.reasons));
    }
    expectSerialisable(result.data);
    const { segments } = result.data;
    expect(segments.map((segment) => segment.segmentId)).toEqual([
      built.segment(1),
      built.segment(0),
    ]);
    const [draw, singles] = segments;
    expect(draw?.workers.map((worker) => worker.outcome)).toEqual(['draw', 'draw']);
    const freeAgent = draw?.workers.find((worker) => worker.personId === built.person(4));
    expect(freeAgent?.momentum).toBeNull();
    expect(singles?.showRegionName).toBe('Test Region North 2');
    const winner = singles?.workers.find((worker) => worker.personId === built.person(0));
    expect(winner).toMatchObject({
      outcome: 'win',
      popularity: { traceRef: popularityGainTraceRef(built.segment(0), built.person(0)) },
      momentum: {
        before: 0,
        traceRef: momentumGainTraceRef(built.segment(0), built.person(0)),
      },
    });
    expect(winner?.popularity.regions[0]?.regionId).toBe(NORTH_2);
    expect(winner?.popularity.regions[0]?.change).toBeGreaterThan(0);
  });

  it('answers for one match, and refuses an unknown one', async () => {
    const { built, engine } = await appliedEngine();
    const one = engine.query('match.aftermath', { segmentId: built.segment(0) }, OMNISCIENT_VIEWER);
    expect(one.ok && one.data.segments.map((segment) => segment.segmentId)).toEqual([
      built.segment(0),
    ]);
    const unknown = engine.query(
      'match.aftermath',
      { segmentId: testId('segment', 99) },
      OMNISCIENT_VIEWER,
    );
    expect(unknown.ok).toBe(false);
  });
});
