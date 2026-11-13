// Wear by body part (MTCH4-01). Design: docs/design/physical-toll.md#wear
import { describe, expect, it } from 'vitest';
import { constantOf } from '../../../../src/core/trace';
import { BODY_PARTS } from '../../../../src/model/entities/person';
import { computeWearByPart } from '../../../../src/systems/match';
import { createEngineTunables } from '../../../../src/systems/tunables';
import { expectSerialisable, expectTraceReplays } from '../../../support/trace';

const LOAD = constantOf('Wear for Kai Moreno', 2, 'Test load');

describe('computeWearByPart', () => {
  it('keeps the BODY_PARTS order and starts every part from the load trace', () => {
    const parts = computeWearByPart(LOAD, { tunables: createEngineTunables() });
    expect(Object.keys(parts)).toEqual([...BODY_PARTS]);
    for (const part of BODY_PARTS) {
      expect(parts[part].trace.children?.[0]).toEqual(LOAD.trace);
      expectTraceReplays(parts[part]);
    }
    expectSerialisable(parts);
  });

  it('sums to load × the sum of the weights', () => {
    const tunables = createEngineTunables();
    const parts = computeWearByPart(LOAD, { tunables });
    const total = BODY_PARTS.reduce((sum, part) => sum + parts[part].value, 0);
    const weights = BODY_PARTS.reduce(
      (sum, part) => sum + tunables.get(`match.wear.part.${part}`),
      0,
    );
    expect(total).toBeCloseTo(2 * weights);
    expect(parts.head.value).toBeCloseTo(1.2);
  });

  it('gives no head wear when the head weight is 0', () => {
    const parts = computeWearByPart(LOAD, {
      tunables: createEngineTunables({ 'match.wear.part.head': 0 }),
    });
    expect(parts.head.value).toBe(0);
    expect(parts.back.value).toBe(2);
  });
});
