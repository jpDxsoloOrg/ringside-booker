// The crowd forecast on the shipped default world falls in the documented bands.
// Design: docs/design/box-office.md#calibration
import { describe, expect, it } from 'vitest';
import { createEngine } from '../../../src/core/api';
import { compareDates } from '../../../src/core/date';
import { RngRegistry } from '../../../src/core/rng/registry';
import { TABLES } from '../../../src/model/tables';
import { documentToWorld } from '../../../src/persistence/world-document';
import {
  BOX_OFFICE_CROWD_STREAM,
  BOX_OFFICE_MERCH_STREAM,
  computeActualAttendance,
  computeBoxOfficeNet,
  computeLiveMerch,
  computeTicketPrice,
  computeVenueRent,
  computeWorkerShare,
  forecastAttendance,
} from '../../../src/systems/boxOffice';
import { defaultSystems } from '../../../src/systems';
import { reachOf } from '../../../src/systems/finance/reach';
import { createEngineTunables } from '../../../src/systems/tunables';
import { withMyShowsRun } from '../../support';
import { playerCardsSystems, type PlayerCards } from '../../support/player-cards';
import { SLOW_TESTS } from '../../support/slow';
import { startDefaultGame } from '../calendar/default-game';

/** The documented band for each show: the forecast for its first scheduled date. */
const BANDS: readonly { readonly show: string; readonly low: number; readonly high: number }[] = [
  { show: 'Mayhem Monday', low: 10_000, high: 18_000 },
  { show: 'SZN Unleashed', low: 15_000, high: 30_000 },
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

/**
 * Show-day money (EVT6-04) for a show's first date at a named venue, with a fixed-seed roll and an
 * average show (score 50, the recent-form par). Shares come from the promotion's active contracts.
 * Amounts are in cents; box-office.md#show-day-calibration records each line.
 */
describe('show-day money calibration on the default world', () => {
  const state = startDefaultGame();
  const world = documentToWorld({ state: { world: state.world } }, TABLES);
  const tunables = createEngineTunables(state.tunableOverrides);
  const AVERAGE_SHOW_SCORE = 50;

  function firstShow(show: string) {
    const first = world.tables.eventInstances
      .values()
      .filter((instance) => instance.name === show)
      .slice()
      .sort((left, right) => compareDates(left.date, right.date))[0];
    if (first === undefined) {
      throw new Error(`No ${show} on the books`);
    }
    return first;
  }

  function netAt(show: string, venueName: string) {
    const instance = firstShow(show);
    const venue = world.tables.venues.values().find((candidate) => candidate.name === venueName);
    if (venue === undefined) {
      throw new Error(`No venue ${venueName}`);
    }
    const forecast = forecastAttendance(world, tunables, instance, { regionId: venue.regionId });
    const rng = new RngRegistry(`calibration:${show}:${venueName}`);
    const crowd = computeActualAttendance(
      { expected: forecast.expected, capacity: venue.capacity, venueName: venue.name },
      { tunables, rng: rng.stream(BOX_OFFICE_CROWD_STREAM) },
    );
    const { reach } = reachOf(world, instance.promotionId, tunables);
    const ticket = computeTicketPrice({ reach, importance: instance.importance }, { tunables });
    const grossGate = ticket.value * crowd.value;
    const rent = computeVenueRent(
      {
        capacity: venue.capacity,
        venueKind: venue.kind,
        venueName: venue.name,
        ownVenue: venue.exclusivePromotionId === instance.promotionId,
      },
      { tunables },
    );
    const merch = computeLiveMerch(
      { attendance: crowd.value, showScore: AVERAGE_SHOW_SCORE },
      { tunables, rng: rng.stream(BOX_OFFICE_MERCH_STREAM) },
    );
    const contracts = world.tables.employments
      .values()
      .filter(
        (employment) =>
          employment.promotionId === instance.promotionId && employment.status === 'active',
      );
    const gateShare = computeWorkerShare(
      {
        gross: grossGate,
        label: 'Gate',
        shares: contracts.map((employment) => ({
          name: employment.ringName,
          bp: employment.terms.shares.gateBp,
        })),
      },
      { tunables },
    );
    const merchShare = computeWorkerShare(
      {
        gross: merch.value,
        label: 'Merch',
        shares: contracts.map((employment) => ({
          name: employment.ringName,
          bp: employment.terms.shares.merchBp,
        })),
      },
      { tunables },
    );
    const net = computeBoxOfficeNet({
      grossGate,
      gateShare,
      rent,
      grossMerch: merch,
      merchShare,
    });
    return net.value;
  }

  it('Altura Mainstage at Harrowmere Arena nets a clear profit', () => {
    expect(netAt('Mayhem Monday', 'Harrowmere Arena')).toBeGreaterThan(40_000_000);
  });

  it('the same show at Kestlewood Stadium loses money on rent', () => {
    expect(netAt('Mayhem Monday', 'Kestlewood Stadium')).toBeLessThan(0);
  });

  it('Wattle Saturday at The Gumleaf Room nets a small positive amount', () => {
    const net = netAt('Wattle Saturday', 'The Gumleaf Room');
    expect(net).toBeGreaterThan(0);
    expect(net).toBeLessThan(500_000);
  });
});

/**
 * A year as Altura (EVT6-11, owner targets): decent shows roughly break even, good shows profit
 * (by less than the +45.7M before the base crowd was lowered) and poor shows lose money. About a
 * minute per year; box-office.md#year-one-calibration records the whole table.
 */
describe.runIf(SLOW_TESTS)('a year of box office as Altura (slow)', () => {
  const TIMEOUT_MS = 600_000;

  async function yearChange(cards: PlayerCards): Promise<{ start: number; change: number }> {
    const state = startDefaultGame();
    const startWorld = documentToWorld({ state: { world: state.world } }, TABLES);
    const altura = startWorld.tables.promotions
      .values()
      .find((promotion) => promotion.name.startsWith('Altura'));
    if (altura === undefined) throw new Error('No Altura');
    const engine = createEngine({
      state,
      systems: withMyShowsRun([...defaultSystems, ...playerCardsSystems(cards)]),
    });
    const advanced = await engine.advanceDays({ maxDays: 365 });
    expect(advanced.failures).toEqual([]);
    const end = documentToWorld({ state: { world: engine.exportState().world } }, TABLES);
    return {
      start: altura.cash,
      change: end.tables.promotions.require(altura.id).cash - altura.cash,
    };
  }

  it(
    'decent shows roughly break even: within 5% of the starting cash',
    async () => {
      const { start, change } = await yearChange('decent');
      expect(Math.abs(change)).toBeLessThanOrEqual(0.05 * start);
    },
    TIMEOUT_MS,
  );

  it(
    'good shows profit, by less than before the base crowd was lowered',
    async () => {
      const { change } = await yearChange('good');
      expect(change).toBeGreaterThan(0);
      expect(change).toBeLessThan(4_570_000_000);
    },
    TIMEOUT_MS,
  );

  it(
    'poor shows lose money',
    async () => {
      const { change } = await yearChange('poor');
      expect(change).toBeLessThan(0);
    },
    TIMEOUT_MS,
  );
});
