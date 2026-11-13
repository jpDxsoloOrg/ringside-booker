// The promotion popularity tunables (EVT5-01). Design: docs/design/promotion-popularity.md
import { describe, expect, it } from 'vitest';
import { createEngine, initialEngineState, type Viewer } from '../../../src/core/api';
import { defaultSystems } from '../../../src/systems';
import { promoPopTunables } from '../../../src/systems/promoPop/tunables';
import { ALL_TUNABLES } from '../../../src/systems/tunables';
import { worldBuilder } from '../../support';

const OMNISCIENT: Viewer = { kind: 'omniscient' };

const EXPECTED_DEFAULTS: Readonly<Record<string, number>> = {
  'promoPop.neighbourReach': 0.5,
  'promoPop.tvReach.tier0': 0.1,
  'promoPop.tvReach.tier1': 0.2,
  'promoPop.tvReach.tier2': 0.3,
  'promoPop.tvReach.tier3': 0.45,
  'promoPop.tvReach.tier4': 0.6,
  'promoPop.expect.popularityWeight': 0.6,
  'promoPop.expect.prestigeWeight': 0.2,
  'promoPop.expect.importance.house': 0.8,
  'promoPop.expect.importance.minor': 0.9,
  'promoPop.expect.importance.regular': 1,
  'promoPop.expect.importance.major': 1.15,
  'promoPop.expect.importance.flagship': 1.3,
  'promoPop.deadZone': 3,
  'promoPop.blowoutMargin': 25,
  'promoPop.maxGainPerShow': 3,
  'promoPop.maxLossPerShow': 2.5,
  'promoPop.impact.house': 0.4,
  'promoPop.impact.minor': 0.7,
  'promoPop.impact.regular': 1,
  'promoPop.impact.major': 1.3,
  'promoPop.impact.flagship': 1.6,
  'promoPop.diminishingPower': 1.5,
  'promoPop.lossFullFrom': 25,
  'promoPop.monthlyGainCap': 3,
  'promoPop.keepShowChangesDays': 365,
};

describe('promotion popularity tunables', () => {
  it('declares exactly the listed keys with their defaults, all in ALL_TUNABLES', () => {
    expect(Object.keys(promoPopTunables).sort()).toEqual(Object.keys(EXPECTED_DEFAULTS).sort());
    const defaults = Object.fromEntries(
      Object.entries(ALL_TUNABLES)
        .filter(([key]) => key.startsWith('promoPop.'))
        .map(([key, def]) => [key, def.default]),
    );
    expect(defaults).toEqual(EXPECTED_DEFAULTS);
  });

  it('lists every one under Promotion popularity with a unit, a range from 0 and a doc anchor', () => {
    const engine = createEngine({
      state: initialEngineState(worldBuilder().build().world),
      systems: defaultSystems,
    });
    const list = engine.query('tunables.list', { category: 'Promotion popularity' }, OMNISCIENT);
    if (!list.ok) {
      expect.fail(JSON.stringify(list.reasons));
    }
    expect(list.data.map((row) => row.key).sort()).toEqual(Object.keys(EXPECTED_DEFAULTS).sort());
    for (const row of list.data) {
      expect(row.docRef).toMatch(
        /^promotion-popularity\.md#(show-reach|region-expectation|show-popularity-change|monthly-cap|after-every-show)$/,
      );
    }
    for (const def of Object.values(promoPopTunables)) {
      expect(def.min).toBe(0);
    }
  });
});
