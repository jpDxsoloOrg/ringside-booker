// The fast paths change nothing (POL4-09): the same seed run with them on and off gives the same
// world, traces and save. Design: docs/design/day-pipeline.md#fast-paths
import { afterEach, describe, expect, it } from 'vitest';
import { createEngine, initialEngineState, worldHash, type EngineState } from '../../src/core/api';
import { fastPathsEnabled, setFastPaths } from '../../src/core/fastPaths';
import { defaultSystems } from '../../src/systems';
import { resetTestIds, rosterWorld } from '../support';
import { withMyShowsRun } from '../support/run-my-shows';
import { SLOW_TESTS } from '../support/slow';
import { startDefaultGame } from '../systems/calendar/default-game';

/** The tables whose numbers the fast paths must never move, named so a failure says which. */
const WORLD_EFFECT_TABLES = [
  'people',
  'employments',
  'promotions',
  'titles',
  'titleReigns',
  'eventInstances',
  'segments',
  'ledgerEntries',
  'aftermaths',
  'popularityShowChanges',
  'aiDecisions',
  'injuries',
  'contractConcerns',
] as const;

async function run(start: () => EngineState, days: number, fast: boolean): Promise<EngineState> {
  const was = setFastPaths(fast);
  try {
    const engine = createEngine({ state: start(), systems: withMyShowsRun([...defaultSystems]) });
    const advanced = await engine.advanceDays({ maxDays: days });
    expect(advanced.failures).toEqual([]);
    return engine.exportState();
  } finally {
    setFastPaths(was);
  }
}

async function expectSameRun(start: () => EngineState, days: number): Promise<void> {
  const full = await run(start, days, false);
  const fast = await run(start, days, true);
  // Real cards were run, so the paths the fast paths shorten were taken.
  expect(fast.world.tables.aftermaths.length).toBeGreaterThan(0);
  expect(fast.traces.summaries.some((entry) => entry.summaryOnly === true)).toBe(true);
  for (const table of WORLD_EFFECT_TABLES) {
    expect(fast.world.tables[table], table).toEqual(full.world.tables[table]);
  }
  expect(fast.traces).toEqual(full.traces);
  expect(fast.rng).toEqual(full.rng);
  expect(worldHash(fast)).toBe(worldHash(full));
}

/** The roster fixture: every promotion computer-run, so every show is a rival show. */
function rosterStart(): EngineState {
  resetTestIds();
  const { world } = rosterWorld(80);
  return initialEngineState({ meta: { ...world.meta, players: [] }, tables: world.tables });
}

describe('the fast paths', () => {
  afterEach(() => {
    expect(fastPathsEnabled()).toBe(true);
  });

  it('are on unless a test turns them off', () => {
    expect(setFastPaths(false)).toBe(true);
    expect(setFastPaths(true)).toBe(false);
  });

  it(
    'leave a month of rival shows exactly as the full path does',
    { timeout: 60_000 },
    async () => {
      await expectSameRun(rosterStart, 35);
    },
  );

  it.runIf(SLOW_TESTS)(
    'leave 120 days of the default world exactly as the full path does',
    { timeout: 600_000 },
    async () => {
      await expectSameRun(() => startDefaultGame(), 120);
    },
  );
});
