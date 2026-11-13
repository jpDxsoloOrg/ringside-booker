// The box office tunables (EVT6-01). Design: docs/design/box-office.md#forecast
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
  'boxOffice.generic.room.capacity': 150,
  'boxOffice.generic.smallHall.capacity': 500,
  'boxOffice.generic.hall.capacity': 1200,
  'boxOffice.generic.largeHall.capacity': 3000,
  'boxOffice.generic.smallArena.capacity': 6000,
  'boxOffice.generic.arena.capacity': 12000,
  'boxOffice.generic.largeArena.capacity': 20000,
  'boxOffice.generic.stadium.capacity': 45000,
  'boxOffice.fit.sellOutAt': 1,
  'boxOffice.fit.emptyAt': 3,
  'boxOffice.pick.headroom': 1.1,
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
        /^box-office\.md#(forecast|recent-form|big-show-fatigue|venues|generic-venues|pick)$/,
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
