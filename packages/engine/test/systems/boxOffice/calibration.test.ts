// The crowd forecast on the shipped default world falls in the documented bands.
// Design: docs/design/box-office.md#calibration
import { describe, expect, it } from 'vitest';
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
import { reachOf } from '../../../src/systems/finance/reach';
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
    expect(netAt('Altura Mainstage', 'Harrowmere Arena')).toBeGreaterThan(40_000_000);
  });

  it('the same show at Kestlewood Stadium loses money on rent', () => {
    expect(netAt('Altura Mainstage', 'Kestlewood Stadium')).toBeLessThan(0);
  });

  it('Wattle Saturday at The Gumleaf Room nets a small positive amount', () => {
    const net = netAt('Wattle Saturday', 'The Gumleaf Room');
    expect(net).toBeGreaterThan(0);
    expect(net).toBeLessThan(500_000);
  });
});
