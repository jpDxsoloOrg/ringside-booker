// The box office tunables (EVT6-01, EVT6-04). Design: docs/design/box-office.md#forecast
import { describe, expect, it } from 'vitest';
import { createEngine, initialEngineState, type Viewer } from '../../../src/core/api';
import { boxOfficeSystem, boxOfficeTunables } from '../../../src/systems/boxOffice';
import { defaultSystems } from '../../../src/systems';
import { ALL_TUNABLES } from '../../../src/systems/tunables';
import { worldBuilder } from '../../support';

const OMNISCIENT: Viewer = { kind: 'omniscient' };

const EXPECTED_DEFAULTS: Readonly<Record<string, number | boolean>> = {
  'boxOffice.draw.atFullPopularity': 30000,
  'boxOffice.draw.curve': 3,
  'boxOffice.draw.walkUp': 80,
  'boxOffice.marketing.perLevel': 0.04,
  'boxOffice.importance.house': 0.35,
  'boxOffice.importance.minor': 0.7,
  'boxOffice.importance.regular': 1,
  'boxOffice.importance.major': 1.5,
  'boxOffice.importance.flagship': 2.2,
  'boxOffice.recentForm.windowDays': 120,
  'boxOffice.recentForm.minShows': 3,
  'boxOffice.recentForm.par': 50,
  'boxOffice.recentForm.fullSwingPoints': 25,
  'boxOffice.recentForm.maxSwing': 0.15,
  'boxOffice.recentForm.countHouseShows': false,
  'boxOffice.fatigue.windowDays': 28,
  'boxOffice.fatigue.freeShows': 1,
  'boxOffice.fatigue.perExtraShow': 0.2,
  'boxOffice.fatigue.floor': 0.25,
  'boxOffice.crowd.spread': 0.1,
  // Show-day money (EVT6-04).
  'boxOffice.ticket.base': 1000,
  'boxOffice.ticket.perReachPoint': 60,
  'boxOffice.ticket.importance.house': 0.8,
  'boxOffice.ticket.importance.minor': 0.9,
  'boxOffice.ticket.importance.regular': 1,
  'boxOffice.ticket.importance.major': 1.5,
  'boxOffice.ticket.importance.flagship': 2,
  'boxOffice.rent.base': 25000,
  'boxOffice.rent.perSeat': 350,
  'boxOffice.rent.kind.hall': 1,
  'boxOffice.rent.kind.theatre': 1.1,
  'boxOffice.rent.kind.arena': 1.25,
  'boxOffice.rent.kind.stadium': 3.5,
  'boxOffice.rent.kind.studio': 0.6,
  'boxOffice.rent.kind.outdoor': 1.2,
  'boxOffice.rent.ownVenueFactor': 0.25,
  'boxOffice.merch.perHead': 500,
  'boxOffice.merch.qualityLow': 0.8,
  'boxOffice.merch.qualityHigh': 1.2,
  'boxOffice.merch.spread': 0.05,
  'boxOffice.gate.workerShareCap': 0.5,
  'boxOffice.merch.workerShareCap': 0.5,
};

describe('box office tunables', () => {
  it('declares exactly the listed keys with their defaults, all in ALL_TUNABLES', () => {
    expect(Object.keys(boxOfficeTunables).sort()).toEqual(Object.keys(EXPECTED_DEFAULTS).sort());
    const defaults = Object.fromEntries(
      Object.entries(ALL_TUNABLES)
        .filter(([key]) => key.startsWith('boxOffice.'))
        .map(([key, def]) => [key, def.default]),
    );
    expect(defaults).toEqual(EXPECTED_DEFAULTS);
  });

  it('lists every one under Box office with a box-office.md anchor', () => {
    const engine = createEngine({
      state: initialEngineState(worldBuilder().build().world),
      systems: defaultSystems,
    });
    const list = engine.query('tunables.list', { category: 'Box office' }, OMNISCIENT);
    if (!list.ok) {
      expect.fail(JSON.stringify(list.reasons));
    }
    expect(list.data.map((row) => row.key).sort()).toEqual(Object.keys(EXPECTED_DEFAULTS).sort());
    for (const row of list.data) {
      expect(row.docRef).toMatch(
        /^box-office\.md#(forecast|recent-form|big-show-fatigue|ticket-price|venue-rent|live-merch|worker-shares)$/,
      );
    }
  });

  it('registers the box office bundle after the finance and shows systems', () => {
    const ids = defaultSystems.map((system) => system.id);
    expect(ids).toContain(boxOfficeSystem.id);
    expect(ids.indexOf('boxOffice')).toBeGreaterThan(ids.indexOf('finance'));
    expect(ids.indexOf('boxOffice')).toBeGreaterThan(ids.indexOf('shows'));
  });
});
