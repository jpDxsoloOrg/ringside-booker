// Popularity drag (ECO7-01). Design: docs/design/production.md#popularity-drag
import { describe, expect, it } from 'vitest';
import type { TunableOverrides } from '../../../src/core/tunables/overrides';
import {
  popularityCeiling,
  popularityDrag,
  UNDER_CEILING_NO_DRAG,
} from '../../../src/systems/production';
import { expectSerialisable, expectTraceContains, expectTraceReplays } from '../../support/trace';
import { deps } from './support';

/** Drag against Hardpan's ceiling of 30. */
function drag(popularity: number, overrides: TunableOverrides = {}) {
  const ceiling = popularityCeiling(
    { promotionName: 'Hardpan', marketing: 1, backOffice: 1 },
    deps(overrides),
  );
  const result = popularityDrag({ regionName: 'Texas', popularity, ceiling }, deps(overrides));
  expectTraceReplays(result);
  expectSerialisable(result.trace);
  return result;
}

describe('popularityDrag', () => {
  it('does nothing below or at the ceiling', () => {
    for (const popularity of [5, 29.9, 30]) {
      const result = drag(popularity);
      expect(result.value, String(popularity)).toBe(0);
      const branch = expectTraceContains(result, { kind: 'branch', label: UNDER_CEILING_NO_DRAG });
      expect(branch.taken).toBe(true);
    }
  });

  it('takes a share of the excess above the ceiling', () => {
    // 20 over the ceiling × 0.02 = 0.4 a day.
    expect(drag(50).value).toBeCloseTo(0.4, 10);
    const result = drag(50);
    expectTraceContains(result, { kind: 'formula', label: 'Hardpan popularity ceiling' });
    expectTraceContains(result, { kind: 'max', label: 'At least' });
    expectTraceContains(result, { kind: 'min', label: 'Never below the ceiling' });
  });

  it('takes at least the floor', () => {
    // 1 over × 0.02 = 0.02, raised to the 0.05 floor.
    expect(drag(31).value).toBeCloseTo(0.05, 10);
    expect(drag(31, { 'production.popularityDrag.minPerDay': 0 }).value).toBeCloseTo(0.02, 10);
  });

  it('never pulls popularity below the ceiling', () => {
    // 0.01 over: the floor of 0.05 would cross the ceiling, so only the excess goes.
    expect(drag(30.01).value).toBeCloseTo(0.01, 10);
    expect(drag(100, { 'production.popularityDrag.fractionPerDay': 1 }).value).toBe(70);
  });

  it('is 0 when both drag tunables are 0', () => {
    const off = {
      'production.popularityDrag.fractionPerDay': 0,
      'production.popularityDrag.minPerDay': 0,
    };
    expect(drag(90, off).value).toBe(0);
  });
});
