// roster.rows stays quick on a roster big enough for the screen's windowed table.
// Design: docs/design/roster.md#roster-rows
import { describe, expect, it } from 'vitest';
import { buildRosterRows, type RosterRow } from '../../../src/systems/roster';
import { createEngineTunables } from '../../../src/systems/tunables';
import { cpuMs } from '../../support/cpu-budget';
import { SLOW_TESTS } from '../../support/slow';
import { rosterWorld } from '../../support/worlds';

const ROSTER_SIZE = 300;
/** Generous on purpose so a loaded CI machine does not flake it; the time is logged. */
const BUDGET_MS = 500;

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
  it.runIf(SLOW_TESTS)(`builds ${String(ROSTER_SIZE)} rows within ${String(BUDGET_MS)} ms`, () => {
    const { rows, elapsed } = buildLargeRoster();
    console.info(
      `buildRosterRows: ${String(rows.length)} rows in ${elapsed.toFixed(1)} ms of CPU time`,
    );
    expect(rows).toHaveLength(ROSTER_SIZE);
    expect(elapsed).toBeLessThan(BUDGET_MS);
  });
});
