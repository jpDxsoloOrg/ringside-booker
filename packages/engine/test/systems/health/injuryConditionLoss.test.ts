// The condition an injury costs. Design: docs/design/health.md#injuries
import { describe, expect, it } from 'vitest';
import type { TunableOverrides } from '../../../src/core/tunables/overrides';
import { computeInjuryConditionLoss } from '../../../src/systems/health';
import { createEngineTunables } from '../../../src/systems/tunables';
import { expectSerialisable, expectTraceContains, expectTraceReplays } from '../../support/trace';

function loss(daysOut: number, currentCondition = 80, overrides: TunableOverrides = {}) {
  const result = computeInjuryConditionLoss(
    { daysOut, currentCondition },
    { tunables: createEngineTunables(overrides) },
  );
  expectTraceReplays(result);
  expectSerialisable(result);
  return result;
}

describe('computeInjuryConditionLoss', () => {
  it('costs a point per week out', () => {
    expect(loss(14).value).toBe(2);
    expect(loss(7).value).toBe(1);
    expect(loss(10).value).toBeCloseTo(10 / 7, 10);
    const result = loss(14);
    expect(result.trace).toMatchObject({
      label: 'Condition lost',
      docRef: 'docs/design/health.md#injuries',
    });
    expectTraceContains(result, { kind: 'constant', label: 'Days per week' });
    expect(expectTraceContains(result, { kind: 'tunable', label: 'Loss per week out' }).key).toBe(
      'health.injury.conditionLossPerWeek',
    );
  });

  it('follows the tunable, and 0 turns the loss off', () => {
    expect(loss(14, 80, { 'health.injury.conditionLossPerWeek': 2.5 }).value).toBe(5);
    expect(loss(14, 80, { 'health.injury.conditionLossPerWeek': 0 }).value).toBe(0);
  });

  it('never takes a part below 0', () => {
    const result = loss(540, 30);
    expect(result.value).toBe(30);
    expect(
      expectTraceContains(result, { kind: 'clamp', label: 'No more than the part has left' })
        .applied,
    ).toBe(true);
    expect(loss(70, 0).value).toBe(0);
  });

  it('accepts traced days out', () => {
    const traced = loss(0);
    expect(traced.value).toBe(0);
  });
});
