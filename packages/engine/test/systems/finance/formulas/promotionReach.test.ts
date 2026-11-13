// Promotion reach. Design: docs/design/finances.md#reach-and-size
import { describe, expect, it } from 'vitest';
import { findTraceNodes, inputOf } from '../../../../src/core/trace';
import type { TunableOverrides } from '../../../../src/core/tunables';
import {
  ALL_REACH_WEIGHTS_ZERO_NOTE,
  promotionReach,
  type PromotionReachInputs,
} from '../../../../src/systems/finance';
import { createEngineTunables } from '../../../../src/systems/tunables';
import {
  expectSerialisable,
  expectTraceContains,
  expectTraceReplays,
} from '../../../support/trace';

const NO_WEIGHTS: TunableOverrides = {
  'finance.reach.weight.homeRegion': 0,
  'finance.reach.weight.homeCountry': 0,
  'finance.reach.weight.homeContinent': 0,
  'finance.reach.weight.world': 0,
};

function levels(region: number, country: number, continent: number, world: number) {
  return {
    homeRegion: region,
    homeCountry: inputOf('Popularity in Testland', country, undefined, 'points'),
    homeContinent: inputOf('Popularity in Test Continent', continent, undefined, 'points'),
    world: inputOf('Popularity worldwide', world, undefined, 'points'),
    homeRegionName: 'Test Region',
    homeCountryName: 'Testland',
    homeContinentName: 'Test Continent',
  } satisfies PromotionReachInputs;
}

function reach(inputs: PromotionReachInputs, overrides: TunableOverrides = {}) {
  const result = promotionReach(inputs, { tunables: createEngineTunables(overrides) });
  expectTraceReplays(result);
  expectSerialisable(result);
  return result;
}

describe('promotionReach', () => {
  it('is 0 when every level is 0 and 100 when every level is 100', () => {
    expect(reach(levels(0, 0, 0, 0)).value).toBe(0);
    expect(reach(levels(100, 100, 100, 100)).value).toBeCloseTo(100, 10);
  });

  it('is the weighted mean of the four levels with the default weights 1, 3, 2 and 2', () => {
    const result = reach(levels(40, 20, 10, 2));
    expect(result.value).toBeCloseTo((1 * 40 + 3 * 20 + 2 * 10 + 2 * 2) / 8, 10);
  });

  it('lists each level as "Popularity in <name>" with its weight tunable', () => {
    const result = reach(levels(40, 20, 10, 2));
    for (const label of [
      'Popularity in Test Region',
      'Popularity in Testland',
      'Popularity in Test Continent',
      'Popularity worldwide',
    ]) {
      expectTraceContains(result, { kind: 'formula', label });
    }
    const keys = findTraceNodes(result.trace, 'tunable').map((node) => node.key);
    expect(keys).toEqual([
      'finance.reach.weight.homeRegion',
      'finance.reach.weight.homeCountry',
      'finance.reach.weight.homeContinent',
      'finance.reach.weight.world',
    ]);
  });

  it('is exactly that level when only one weight is set', () => {
    const result = reach(levels(40, 20, 10, 2), {
      ...NO_WEIGHTS,
      'finance.reach.weight.homeCountry': 2.5,
    });
    expect(result.value).toBeCloseTo(20, 10);
  });

  it('drops a level whose weight is overridden to 0 (0 means 0)', () => {
    const result = reach(levels(40, 20, 10, 2), { 'finance.reach.weight.homeRegion': 0 });
    expect(result.value).toBeCloseTo((3 * 20 + 2 * 10 + 2 * 2) / 7, 10);
  });

  it('is 0 with a note, never a division by zero, when every weight is 0', () => {
    const result = reach(levels(40, 20, 10, 2), NO_WEIGHTS);
    expect(result.value).toBe(0);
    expectTraceContains(result, { kind: 'note', label: ALL_REACH_WEIGHTS_ZERO_NOTE });
    expect(findTraceNodes(result.trace, 'divide')).toEqual([]);
  });

  it('keeps the exact value (no rounding in the trace)', () => {
    const result = reach(levels(33, 33, 33, 34));
    expect(result.value).toBeCloseTo((33 * 6 + 34 * 2) / 8, 10);
    expect(result.value).not.toBe(Math.round(result.value * 10) / 10);
  });
});
