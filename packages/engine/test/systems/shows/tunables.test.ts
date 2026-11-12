// The shows system's tunables (EVT3-01). Design: docs/design/show-night.md, docs/design/tunables.md
import { describe, expect, it } from 'vitest';
import { createEngine, initialEngineState, type Viewer } from '../../../src/core/api';
import { defaultSystems } from '../../../src/systems';
import { showsTunables } from '../../../src/systems/shows/tunables';
import { ALL_TUNABLES, createEngineTunables } from '../../../src/systems/tunables';
import { worldBuilder } from '../../support';

const OMNISCIENT: Viewer = { kind: 'omniscient' };

const EXPECTED_DEFAULTS: Readonly<Record<string, number | boolean>> = {
  'shows.score.preShowFactor': 0,
  'shows.emptySlotPenalty': 5,
  'shows.offscreen.base': 12,
  'shows.offscreen.prestigeWeight': 0.3,
  'shows.offscreen.popularityWeight': 0.35,
  'shows.offscreen.importance.house': -6,
  'shows.offscreen.importance.minor': -3,
  'shows.offscreen.importance.regular': 0,
  'shows.offscreen.importance.major': 4,
  'shows.offscreen.importance.flagship': 8,
  'shows.offscreen.spread': 8,
  'shows.titles.drawCountsAsDefence': true,
  'shows.stars.zeroAt': 35,
  'shows.stars.pointsPerStar': 12,
};

describe('shows tunables', () => {
  it('declares exactly the listed keys with their defaults, all in ALL_TUNABLES', () => {
    expect(Object.keys(showsTunables).sort()).toEqual(Object.keys(EXPECTED_DEFAULTS).sort());
    const defaults = Object.fromEntries(
      Object.entries(ALL_TUNABLES)
        .filter(([key]) => key.startsWith('shows.'))
        .map(([key, def]) => [key, def.default]),
    );
    expect(defaults).toEqual(EXPECTED_DEFAULTS);
  });

  it('lists every shows tunable under the Shows category', () => {
    const engine = createEngine({
      state: initialEngineState(worldBuilder().build().world),
      systems: defaultSystems,
    });
    const list = engine.query('tunables.list', { category: 'Shows' }, OMNISCIENT);
    if (!list.ok) {
      expect.fail(JSON.stringify(list.reasons));
    }
    expect(list.data.map((row) => row.key).sort()).toEqual(Object.keys(EXPECTED_DEFAULTS).sort());
    expect(list.data.every((row) => row.docRef?.startsWith('show-night.md#'))).toBe(true);
  });

  it('reads back an override of the pre-show factor', () => {
    const zero = createEngineTunables({ 'shows.score.preShowFactor': 0 });
    expect(zero.get('shows.score.preShowFactor')).toBe(0);
    expect(zero.isOverridden('shows.score.preShowFactor')).toBe(true);
    const half = createEngineTunables({ 'shows.score.preShowFactor': 0.5 });
    expect(half.get('shows.score.preShowFactor')).toBe(0.5);
  });
});

describe('shows system', () => {
  it('is registered after the match system with no duplicate system ids', () => {
    const ids = defaultSystems.map((system) => system.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.indexOf('shows')).toBeGreaterThan(ids.indexOf('match'));
    expect(() =>
      createEngine({
        state: initialEngineState(worldBuilder().build().world),
        systems: defaultSystems,
      }),
    ).not.toThrow();
  });
});
