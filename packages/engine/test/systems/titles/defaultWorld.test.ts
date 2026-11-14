// The orphaned-champion rule on the shipped default world (CRTV1-03): a month of play vacates no
// title, because every champion still works for their promotion. A new default-world game takes a
// few seconds and a month of it a few more, so this runs with `RB_SLOW_TESTS=1`.
// Design: docs/design/titles.md#orphaned-champions
import { describe, expect, it } from 'vitest';
import { createEngine } from '../../../src/core/api';
import { defaultSystems } from '../../../src/systems';
import { withMyShowsRun } from '../../support';
import { SLOW_TESTS } from '../../support/slow';
import { startDefaultGame } from '../calendar/default-game';

const DAYS = 30;

describe.runIf(SLOW_TESTS)('titles.vacateOrphaned on the default world', () => {
  it(`vacates no title in ${String(DAYS)} days`, { timeout: 120_000 }, async () => {
    const engine = createEngine({
      state: startDefaultGame(),
      systems: withMyShowsRun(defaultSystems),
    });
    const result = await engine.advanceDays({ maxDays: DAYS });
    expect(result.failures).toEqual([]);
    expect(result.daysAdvanced).toBe(DAYS);
    const vacated = engine
      .exportState()
      .world.tables.titleReigns.filter((reign) => reign.endReason === 'vacated');
    expect(vacated).toEqual([]);
    const events = engine.query(
      'sim.recentEvents',
      { limit: 500, types: ['title.vacated'] },
      { kind: 'omniscient' },
    );
    expect(events.ok && events.data).toEqual([]);
  });
});
