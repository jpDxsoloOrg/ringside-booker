// roster.rows stays quick on a roster big enough for the screen's windowed table.
// Design: docs/design/roster.md#roster-rows
import { describe, expect, it } from 'vitest';
import { buildRosterRows, type RosterRow } from '../../../src/systems/roster';
import { createEngineTunables } from '../../../src/systems/tunables';
import { cpuMs } from '../../support/cpu-budget';
import { rosterWorld } from '../../support/worlds';

const ROSTER_SIZE = 300;
/** Generous on purpose so a loaded CI machine does not flake it; the time is logged. */
const BUDGET_MS = 500;

describe('buildRosterRows on a large roster', () => {
  it(`builds ${String(ROSTER_SIZE)} rows within ${String(BUDGET_MS)} ms`, () => {
    const { world, ids } = rosterWorld(ROSTER_SIZE);
    const promotionId = ids.promotions.A;
    if (promotionId === undefined) throw new Error('rosterWorld has no promotion');
    const deps = { tunables: createEngineTunables(), traces: { has: () => false } };
    let rows: RosterRow[] = [];
    const elapsed = cpuMs(() => {
      rows = buildRosterRows(world, promotionId, world.meta.currentDate, deps);
    });
    console.info(
      `buildRosterRows: ${String(rows.length)} rows in ${elapsed.toFixed(1)} ms of CPU time`,
    );
    expect(rows).toHaveLength(ROSTER_SIZE);
    expect(elapsed).toBeLessThan(BUDGET_MS);
  });
});
