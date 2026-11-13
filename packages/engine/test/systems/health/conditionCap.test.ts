// The healing cap for a worker's age. Design: docs/design/health.md#condition-cap
import { describe, expect, it } from 'vitest';
import type { TunableOverrides } from '../../../src/core/tunables/overrides';
import { computeConditionCap } from '../../../src/systems/health';
import { createEngineTunables } from '../../../src/systems/tunables';
import { expectSerialisable, expectTraceContains, expectTraceReplays } from '../../support/trace';

function capAt(age: number, overrides: TunableOverrides = {}, agingEnabled = true) {
  const result = computeConditionCap(
    { age, agingEnabled },
    { tunables: createEngineTunables(overrides) },
  );
  expectTraceReplays(result);
  expectSerialisable(result);
  return result;
}

describe('computeConditionCap', () => {
  it('is 100 up to 30, 85 at 40, 70 at 50 and 55 from 60 on', () => {
    expect(capAt(18).value).toBe(100);
    expect(capAt(30).value).toBe(100);
    expect(capAt(40).value).toBe(85);
    expect(capAt(50).value).toBe(70);
    expect(capAt(60).value).toBe(55);
    expect(capAt(75).value).toBe(55);
  });

  it('labels the result and points at the design doc', () => {
    expect(capAt(40).trace).toMatchObject({
      kind: 'formula',
      label: 'Healing cap for their age',
      unit: 'points',
      docRef: 'docs/design/health.md#condition-cap',
    });
  });

  it('records the floor biting only once the age drop passes it', () => {
    expect(expectTraceContains(capAt(50), { kind: 'max', label: 'Lowest cap' }).applied).toBe(
      false,
    );
    expect(expectTraceContains(capAt(70), { kind: 'max', label: 'Lowest cap' })).toMatchObject({
      before: 40,
      after: 55,
      applied: true,
    });
  });

  it('keeps 100 for life when the cap drops 0 a year', () => {
    expect(capAt(70, { 'health.condition.capDropPerYear': 0 }).value).toBe(100);
  });

  it('drops to 0 with the largest yearly drop and a floor of 0, the floor catching it', () => {
    const result = capAt(60, {
      'health.condition.capDropPerYear': 10,
      'health.condition.capFloor': 0,
    });
    expect(result.value).toBe(0);
    expect(expectTraceContains(result, { kind: 'max', label: 'Lowest cap' })).toMatchObject({
      before: -200,
      after: 0,
      applied: true,
    });
    expect(expectTraceContains(result, { kind: 'clamp' }).applied).toBe(false);
  });

  it('follows the age the cap starts falling from', () => {
    expect(capAt(40, { 'health.condition.capAgeFrom': 40 }).value).toBe(100);
    expect(capAt(40, { 'health.condition.capAgeFrom': 18 }).value).toBe(67);
  });

  it('takes the "Aging is off in this world" branch and stays at 100 at any age', () => {
    const result = capAt(70, {}, false);
    expect(result.value).toBe(100);
    expect(
      expectTraceContains(result, { kind: 'branch', label: 'Aging is off in this world' }).taken,
    ).toBe(true);
  });
});
