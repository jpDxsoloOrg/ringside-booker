// Show night on the shipped default world: every rival show runs, nothing is left open, and the
// month stays inside the CI budget. Design: docs/design/show-night.md#phase
import { describe, expect, it } from 'vitest';
import { SLOW_TESTS } from '../../support/slow';
import { createEngine } from '../../../src/core/api';
import { compareDates } from '../../../src/core/date';
import { SYSTEMS_WITHOUT_SHOW_DAY_GATE } from '../../support';
import { startDefaultGame } from '../calendar/default-game';
import { OMNISCIENT } from './show-night-world';

const DAYS = 30;
/** Generous on purpose: CI machines are slow. A month locally takes well under a second. */
const BUDGET_MS = 15_000;

function now(): number {
  // eslint-disable-next-line no-restricted-properties -- a speed test has to read the real clock
  return performance.now();
}

describe('shows.runShows on the default world', () => {
  // The test timeout sits above the budget: at vitest's default 5 s the budget could never fail,
  // and a busy machine timed the month out instead.
  it.runIf(SLOW_TESTS)(
    'runs a month of shows with no failures and leaves no past show open',
    { timeout: BUDGET_MS + 5_000 },
    async () => {
      const engine = createEngine({
        state: startDefaultGame(),
        systems: SYSTEMS_WITHOUT_SHOW_DAY_GATE,
        host: { now },
      });
      const startedAt = now();
      const showPhaseMs: number[] = [];
      for (let day = 0; day < DAYS; day += 1) {
        const advanced = await engine.advanceDays({ maxDays: 1 });
        expect(advanced.failures).toEqual([]);
        const report = engine.query('sim.lastDayReport', {}, OMNISCIENT);
        if (!report.ok || report.data === null) {
          throw new Error('No day report');
        }
        const step = report.data.steps.find((candidate) => candidate.stepId === 'shows.runShows');
        showPhaseMs.push(step?.status === 'ok' ? step.timing.ms : 0);
      }
      expect(now() - startedAt).toBeLessThan(BUDGET_MS);
      expect(showPhaseMs.some((ms) => ms > 0)).toBe(true);

      const state = engine.exportState();
      const today = state.world.meta.currentDate;
      const past = state.world.tables.eventInstances.filter(
        (show) => compareDates(show.date, today) < 0,
      );
      expect(past.filter((show) => show.status === 'completed').length).toBeGreaterThan(0);
      expect(
        past.filter((show) => show.status === 'scheduled' || show.status === 'booked'),
      ).toEqual([]);
    },
  );
});
