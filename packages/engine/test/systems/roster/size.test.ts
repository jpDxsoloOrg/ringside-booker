// roster.rows stays quick on a roster big enough for the screen's windowed table.
// Design: docs/design/roster.md#roster-rows
import { describe, expect, it } from 'vitest';
import { buildRosterRows, type RosterRow } from '../../../src/systems/roster';
import { createEngineTunables } from '../../../src/systems/tunables';
import { cpuMs, measureBestAgainstReference } from '../../support/cpu-budget';
import { SLOW_TESTS } from '../../support/slow';
import { rosterWorld } from '../../support/worlds';

const ROSTER_SIZE = 300;
/**
 * At most this many runs of the CPU reference workload (about 50 ms each on a laptop, so about
 * 500 ms). A ratio, not milliseconds: the engine's test threads share one process, and
 * `process.cpuUsage()` counts them all, so only a ratio against the reference holds up.
 */
const BUDGET_REFERENCES = 10;

function buildLargeRoster(): { rows: RosterRow[]; elapsed: number } {
  const { world, ids } = rosterWorld(ROSTER_SIZE);
  const promotionId = ids.promotions.A;
  if (promotionId === undefined) throw new Error('rosterWorld has no promotion');
  const deps = { tunables: createEngineTunables(), traces: { has: () => false } };
  let rows: RosterRow[] = [];
  const elapsed = cpuMs(() => {
    rows = buildRosterRows(world, promotionId, world.meta.currentDate, deps);
  });
  return { rows, elapsed };
}

describe('buildRosterRows on a large roster', () => {
  it(`builds a row for each of ${String(ROSTER_SIZE)} contracts`, () => {
    const { rows } = buildLargeRoster();
    expect(rows).toHaveLength(ROSTER_SIZE);
    expect(new Set(rows.map((row) => row.employmentId)).size).toBe(ROSTER_SIZE);
  });

  // A timing budget: only with the slow suites (RB_SLOW_TESTS=1), so a loaded machine running
  // the default `npm test` cannot flake it.
  it.runIf(SLOW_TESTS)(
    `builds ${String(ROSTER_SIZE)} rows within ${String(BUDGET_REFERENCES)} reference workloads`,
    () => {
      const { world, ids } = rosterWorld(ROSTER_SIZE);
      const promotionId = ids.promotions.A;
      if (promotionId === undefined) throw new Error('rosterWorld has no promotion');
      const deps = { tunables: createEngineTunables(), traces: { has: () => false } };
      let rows: RosterRow[] = [];
      const result = measureBestAgainstReference(() => {
        rows = buildRosterRows(world, promotionId, world.meta.currentDate, deps);
      }, 3);
      console.info(
        `buildRosterRows: ${String(rows.length)} rows in ${result.workMs.toFixed(1)} ms of CPU time (${result.ratio.toFixed(2)} reference workloads of ${result.referenceMs.toFixed(1)} ms)`,
      );
      expect(rows).toHaveLength(ROSTER_SIZE);
      expect(result.ratio).toBeLessThan(BUDGET_REFERENCES);
    },
  );
});
