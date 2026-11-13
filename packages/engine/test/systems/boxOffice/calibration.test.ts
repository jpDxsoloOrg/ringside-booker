// The crowd forecast on the shipped default world falls in the documented bands.
// Design: docs/design/box-office.md#calibration
import { describe, expect, it } from 'vitest';
import { compareDates } from '../../../src/core/date';
import { TABLES } from '../../../src/model/tables';
import { documentToWorld } from '../../../src/persistence/world-document';
import { forecastAttendance } from '../../../src/systems/boxOffice';
import { createEngineTunables } from '../../../src/systems/tunables';
import { startDefaultGame } from '../calendar/default-game';

/** The documented band for each show: the forecast for its first scheduled date. */
const BANDS: readonly { readonly show: string; readonly low: number; readonly high: number }[] = [
  { show: 'Altura Mainstage', low: 10_000, high: 18_000 },
  { show: 'Altitude', low: 25_000, high: 55_000 },
  { show: 'Tessen Iron Hour', low: 6_000, high: 14_000 },
  { show: 'Wattle Saturday', low: 100, high: 400 },
  { show: 'Hardpan Friday', low: 100, high: 500 },
];

describe('crowd forecast calibration on the default world', () => {
  const state = startDefaultGame();
  const world = documentToWorld({ state: { world: state.world } }, TABLES);
  const tunables = createEngineTunables(state.tunableOverrides);

  it.each(BANDS)('forecasts $show between $low and $high', ({ show, low, high }) => {
    const first = world.tables.eventInstances
      .values()
      .filter((instance) => instance.name === show)
      .slice()
      .sort((left, right) => compareDates(left.date, right.date))[0];
    if (first === undefined) {
      throw new Error(`No ${show} on the books`);
    }
    const forecast = forecastAttendance(world, tunables, first);
    expect(forecast.expected.value).toBeGreaterThanOrEqual(low);
    expect(forecast.expected.value).toBeLessThanOrEqual(high);
  });
});
