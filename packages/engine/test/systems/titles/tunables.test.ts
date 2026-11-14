// The titles system's tunables and registration (CRTV1-01, CRTV1-03). Design: docs/design/titles.md
import { describe, expect, it } from 'vitest';
import { createEngine, initialEngineState, type Viewer } from '../../../src/core/api';
import { defaultSystems } from '../../../src/systems';
import { titlesTunables } from '../../../src/systems/titles';
import { ALL_TUNABLES } from '../../../src/systems/tunables';
import { worldBuilder } from '../../support';

const OMNISCIENT: Viewer = { kind: 'omniscient' };

const EXPECTED_DEFAULTS: Readonly<Record<string, number>> = {
  'titles.startPrestige.world': 55,
  'titles.startPrestige.secondary': 35,
  'titles.startPrestige.specialty': 20,
  'titles.startPrestige.promotionAnchor': 50,
  'titles.startPrestige.promotionWeight': 0.3,
  'titles.orphanGraceDays': 7,
};

describe('titles system', () => {
  it('is in defaultSystems right after workers', () => {
    const ids = defaultSystems.map((system) => system.id);
    expect(ids.indexOf('titles')).toBe(ids.indexOf('workers') + 1);
  });

  it('declares exactly the starting-prestige and orphan keys, all in ALL_TUNABLES', () => {
    expect(Object.keys(titlesTunables).sort()).toEqual(Object.keys(EXPECTED_DEFAULTS).sort());
    const defaults = Object.fromEntries(
      Object.entries(ALL_TUNABLES)
        .filter(([key]) => key.startsWith('titles.'))
        .map(([key, def]) => [key, def.default]),
    );
    expect(defaults).toEqual(EXPECTED_DEFAULTS);
  });

  it('lists them under the Titles category with descriptions and the doc anchor', () => {
    const engine = createEngine({
      state: initialEngineState(worldBuilder().build().world),
      systems: defaultSystems,
    });
    const list = engine.query('tunables.list', { category: 'Titles' }, OMNISCIENT);
    if (!list.ok) {
      expect.fail(JSON.stringify(list.reasons));
    }
    expect(list.data.map((row) => row.key).sort()).toEqual(Object.keys(EXPECTED_DEFAULTS).sort());
    expect(list.data.every((row) => row.description.length > 0)).toBe(true);
    expect(
      list.data.every((row) =>
        row.key === 'titles.orphanGraceDays'
          ? row.docRef === 'titles.md#orphaned-champions'
          : row.docRef === 'titles.md#starting-prestige',
      ),
    ).toBe(true);
  });
});
