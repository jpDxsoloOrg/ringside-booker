/**
 * Informational benchmark, not part of `npm test`. Run it with:
 *
 *   npx vitest bench --project engine --run test/systems/calendar/queries
 *
 * A calendar month grid shows six weeks, so both reads are measured over 42 days on the default
 * world after two simulated years. The budget is 20 ms each. Measured on a development laptop
 * (2026-11): `calendar.range` for the whole world about 0.2 ms (65 shows), and
 * `calendar.projected` for the whole world about 0.45 ms (68 shows).
 * Design: docs/design/calendar.md#queries
 */
import { bench, describe } from 'vitest';
import { addDays, createEngine, defaultSystems } from '@ringside/engine';
import { startDefaultGame } from './default-game';

const TWO_YEARS_IN_DAYS = 730;
const SIX_WEEKS_IN_DAYS = 41;
const VIEWER = {
  kind: 'controller',
  controller: { kind: 'human', playerId: 'local-player' },
} as const;

const engine = createEngine({ state: startDefaultGame(), systems: defaultSystems });
const advanced = await engine.advanceDays({ maxDays: TWO_YEARS_IN_DAYS });
if (advanced.daysAdvanced !== TWO_YEARS_IN_DAYS) {
  throw new Error(`The two-year run stopped early: ${JSON.stringify(advanced)}`);
}

const clock = engine.query('clock.get', {}, VIEWER);
if (!clock.ok) {
  throw new Error(`clock.get failed: ${JSON.stringify(clock.reasons)}`);
}
const today = clock.data.date;
const horizon = engine.query('calendar.range', { from: today, to: today, scope: 'world' }, VIEWER);
if (!horizon.ok) {
  throw new Error(`calendar.range failed: ${JSON.stringify(horizon.reasons)}`);
}
const storedWindow = {
  from: today,
  to: addDays(today, SIX_WEEKS_IN_DAYS),
  scope: 'world',
} as const;
const firstProjectedDay = addDays(horizon.data.horizonEnd, 1);
const projectedWindow = {
  from: firstProjectedDay,
  to: addDays(firstProjectedDay, SIX_WEEKS_IN_DAYS),
  scope: 'world',
} as const;

function countOf(
  name: 'calendar.range' | 'calendar.projected',
  window: typeof storedWindow,
): number {
  const result = engine.query(name, window, VIEWER);
  if (!result.ok) {
    throw new Error(`${name} failed: ${JSON.stringify(result.reasons)}`);
  }
  return result.data.shows.length;
}

const storedCount = countOf('calendar.range', storedWindow);
const projectedCount = countOf('calendar.projected', projectedWindow);

describe('calendar queries over 42 days, default world after two years', () => {
  bench(`calendar.range, whole world (${String(storedCount)} shows)`, () => {
    engine.query('calendar.range', storedWindow, VIEWER);
  });

  bench(`calendar.projected, whole world (${String(projectedCount)} shows)`, () => {
    engine.query('calendar.projected', projectedWindow, VIEWER);
  });

  bench('calendar.nextShow, own shows', () => {
    engine.query('calendar.nextShow', {}, VIEWER);
  });
});
