// Upgrade fee (ECO7-01). Design: docs/design/production.md#upgrade-fee
import { describe, expect, it } from 'vitest';
import type { TunableOverrides } from '../../../src/core/tunables/overrides';
import { PRODUCTION_AREAS, type ProductionArea } from '../../../src/model/entities/promotion';
import { LOWERING_IS_FREE, UPGRADE_FEE_KEYS, upgradeFee } from '../../../src/systems/production';
import { expectSerialisable, expectTraceContains, expectTraceReplays } from '../../support/trace';
import { deps } from './support';

function fee(area: ProductionArea, from: number, to: number, overrides: TunableOverrides = {}) {
  const result = upgradeFee({ area, from, to }, deps(overrides));
  expectTraceReplays(result);
  expectSerialisable(result.trace);
  return result;
}

describe('upgradeFee', () => {
  it('charges $28,000 to raise camera from 2 to 4', () => {
    const result = fee('camera', 2, 4);
    expect(result.value).toBe(2_800_000);
    expect(result.trace.label).toBe('Camera 2 → 4');
    expectTraceContains(result, { kind: 'formula', label: 'Curve at 4: 0.064' });
    expectTraceContains(result, { kind: 'formula', label: 'Curve at 2: 0.008' });
    expectTraceContains(result, { kind: 'multiply', label: 'Camera fee for 0 → 10: $500,000' });
    expectTraceContains(result, { kind: 'branch', label: LOWERING_IS_FREE });
  });

  it('is free to lower or keep a level', () => {
    expect(fee('camera', 4, 2).value).toBe(0);
    expect(fee('camera', 3, 3).value).toBe(0);
    expect(fee('stage', 10, 0).value).toBe(0);
    const lowered = fee('camera', 4, 2);
    const branch = expectTraceContains(lowered, { kind: 'branch', label: LOWERING_IS_FREE });
    expect(branch.taken).toBe(true);
  });

  it('costs the same raised in steps as in one go, to the cent', () => {
    expect(fee('camera', 2, 3).value + fee('camera', 3, 4).value).toBe(fee('camera', 2, 4).value);
    // An awkward price and curve, where rounding each step on its own would drift.
    const odd: TunableOverrides = {
      'production.upgradeFee.music': 3_333_333,
      'production.costCurve': 2.7,
    };
    for (const area of ['music'] as const) {
      let stepped = 0;
      for (let level = 0; level < 10; level += 1) {
        stepped += fee(area, level, level + 1, odd).value;
      }
      expect(stepped).toBe(fee(area, 0, 10, odd).value);
    }
  });

  it('charges the whole 0 → 10 fee for the full climb', () => {
    const tunables = deps().tunables;
    for (const area of PRODUCTION_AREAS) {
      expect(fee(area, 0, 10).value, area).toBe(tunables.get(UPGRADE_FEE_KEYS[area]));
    }
  });

  it('is free when the fee is 0', () => {
    expect(fee('pyro', 0, 10, { 'production.upgradeFee.pyro': 0 }).value).toBe(0);
  });

  it('rejects a level outside 0..10', () => {
    expect(() => upgradeFee({ area: 'camera', from: -1, to: 4 }, deps())).toThrow();
    expect(() => upgradeFee({ area: 'camera', from: 2, to: 11 }, deps())).toThrow();
  });
});
