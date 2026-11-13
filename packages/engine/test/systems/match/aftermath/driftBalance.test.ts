// Momentum drift balance on the default world (MTCH3-07): with every show given a card
// (`cardEveryShowSystem`, MTCH3-05's measurement setup), momentum no longer bunches at ±100.
//
// `npm test` runs 13 weeks to stay fast. The full year the ticket reports is opt-in:
//   RB_BALANCE_DAYS=365 npx vitest run --root ../.. --project engine test/systems/match/aftermath/driftBalance
// Measured 2026-11 over the 193 active wrestlers after 365 days: without drift p10 −100, p50 +18.5,
// p90 +100 (40% at ±100); with drift p10 −28.5, p50 −0.7, p90 +31.5 (none at ±100), and the
// busiest winners (a win a week) between +65 and +81.
// Design: docs/design/match-aftermath.md#momentum-drift
import { describe, expect, it } from 'vitest';
import { createEngine } from '../../../../src/core/api';
import { quantileOfSorted } from '../../../../src/systems/match';
import { SYSTEMS_WITHOUT_SHOW_DAY_GATE } from '../../../support';
import { cardEveryShowSystem } from '../../../support/card-every-show';
import { startDefaultGame } from '../../calendar/default-game';

const DAYS = Number(process.env['RB_BALANCE_DAYS'] ?? '91');
/** Generous: a busy machine runs the default world several times slower. */
const TIMEOUT_MS = 120_000 + DAYS * 2_000;

describe('momentum drift on the default world with every show carded', () => {
  it(
    `keeps fewer than 10% of wrestlers at ±100 after ${String(DAYS)} days`,
    { timeout: TIMEOUT_MS },
    async () => {
      const engine = createEngine({
        state: startDefaultGame(),
        systems: [...SYSTEMS_WITHOUT_SHOW_DAY_GATE, cardEveryShowSystem],
      });
      const advanced = await engine.advanceDays({ maxDays: DAYS });
      expect(advanced.failures).toEqual([]);

      const { employments } = engine.exportState().world.tables;
      const momentum = employments
        .filter((row) => row.status === 'active' && row.role === 'wrestler')
        .map((row) => row.momentum)
        .filter((value): value is number => value !== null)
        .sort((left, right) => left - right);
      const atLimit = momentum.filter((value) => Math.abs(value) === 100).length;
      const p10 = quantileOfSorted(momentum, 0.1);
      const p50 = quantileOfSorted(momentum, 0.5);
      const p90 = quantileOfSorted(momentum, 0.9);
      console.log(
        `momentum after ${String(DAYS)} days, ${String(momentum.length)} wrestlers: p10 ${p10.toFixed(1)}, p50 ${p50.toFixed(1)}, p90 ${p90.toFixed(1)}, ${String(atLimit)} at ±100`,
      );

      expect(momentum.length).toBeGreaterThan(100);
      expect(atLimit / momentum.length).toBeLessThan(0.1);
      expect(p10).toBeGreaterThan(-100);
      expect(p90).toBeLessThan(100);
      // Momentum still moves with results: the spread is wide and the busiest winners run hot.
      expect(p90 - p10).toBeGreaterThan(30);
      expect(momentum.at(-1)).toBeGreaterThan(60);
    },
  );
});
