// Weekly body-condition healing. Design: docs/design/health.md#condition-recovery
import { describe, expect, it } from 'vitest';
import type { Traced } from '../../../src/core/trace/types';
import type { TunableOverrides } from '../../../src/core/tunables/overrides';
import {
  AT_CAP_BRANCH,
  computeConditionCap,
  computeConditionRecovery,
  INJURED_PART_BRANCH,
  type ConditionRecoveryInputs,
} from '../../../src/systems/health';
import {
  conditionRecoveryValue,
  conditionWeeklyGainValue,
} from '../../../src/systems/health/formulas/conditionRecovery';
import { createEngineTunables } from '../../../src/systems/tunables';
import { expectSerialisable, expectTraceContains, expectTraceReplays } from '../../support/trace';

function capFor(age: number): Traced<number> {
  return computeConditionCap({ age, agingEnabled: true }, { tunables: createEngineTunables() });
}

/** A 25-year-old's uninjured part, no body trait, standard care from Apex. */
const BASE: ConditionRecoveryInputs = {
  current: 80,
  cap: capFor(25),
  partInjured: false,
  traits: [],
  medicalLevel: 1,
  medicalSource: 'Apex Wrestling',
};

function heal(inputs: Partial<ConditionRecoveryInputs> = {}, overrides: TunableOverrides = {}) {
  const given = { ...BASE, ...inputs };
  const tunables = createEngineTunables(overrides);
  const result = computeConditionRecovery(given, { tunables });
  expectTraceReplays(result);
  expectSerialisable(result);
  // The fast path (POL4-10) gives the same number to the bit.
  const gain = conditionWeeklyGainValue(given, { tunables });
  expect(
    conditionRecoveryValue(
      { current: given.current, cap: given.cap.value, partInjured: given.partInjured },
      gain,
    ),
  ).toBe(result.value);
  return result;
}

describe('computeConditionRecovery', () => {
  it('heals half a point a week at standard care', () => {
    const result = heal();
    expect(result.value).toBe(80.5);
    expect(result.trace).toMatchObject({
      label: 'Condition after a week of healing',
      docRef: 'docs/design/health.md#condition-recovery',
    });
    expect(
      expectTraceContains(result, {
        kind: 'multiply',
        label: 'Medical care: Apex Wrestling (level 1)',
      }).operand,
    ).toBe(1);
  });

  it('heals faster at medical level 3 and slower at level 0', () => {
    expect(heal({ medicalLevel: 3 }).value).toBeCloseTo(80.65, 10);
    expect(heal({ medicalLevel: 2 }).value).toBeCloseTo(80.575, 10);
    expect(heal({ medicalLevel: 0 }).value).toBeCloseTo(80.4, 10);
  });

  it('says "No employer: standard care" for a free agent', () => {
    const result = heal({ medicalSource: null });
    expect(result.value).toBe(80.5);
    expectTraceContains(result, { kind: 'multiply', label: 'No employer: standard care' });
  });

  it('names the durable and injury-prone traits', () => {
    const durable = heal({ traits: ['durable'] });
    expect(durable.value).toBeCloseTo(80.625, 10);
    expect(expectTraceContains(durable, { kind: 'branch', label: 'Durable' }).taken).toBe(true);
    const prone = heal({ traits: ['injuryProne'] });
    expect(prone.value).toBeCloseTo(80.375, 10);
    expect(expectTraceContains(prone, { kind: 'tunable', label: 'Injury prone' }).key).toBe(
      'health.condition.injuryProneMultiplier',
    );
    expect(heal({ traits: ['workhorse'] }).value).toBe(80.5);
  });

  it('does not heal an injured part, and says why', () => {
    const result = heal({ partInjured: true, current: 40 });
    expect(result.value).toBe(40);
    expect(expectTraceContains(result, { kind: 'branch', label: INJURED_PART_BRANCH }).taken).toBe(
      true,
    );
  });

  it('never lowers a part already at or above the cap for their age', () => {
    const fifty = capFor(50);
    expect(fifty.value).toBe(70);
    const above = heal({ cap: fifty, current: 90 });
    expect(above.value).toBe(90);
    expect(expectTraceContains(above, { kind: 'branch', label: AT_CAP_BRANCH }).taken).toBe(true);
    expect(heal({ cap: fifty, current: 70 }).value).toBe(70);
  });

  it('stops at the cap when a week would take it past', () => {
    const result = heal({ cap: capFor(50), current: 69.8 });
    expect(result.value).toBe(70);
    expect(
      expectTraceContains(result, { kind: 'min', label: 'Healing cap for their age' }),
    ).toMatchObject({
      applied: true,
      limit: 70,
    });
  });

  it('keeps 100 at 100 and lifts 0 by the weekly amount', () => {
    expect(heal({ current: 100 }).value).toBe(100);
    expect(heal({ current: 0 }).value).toBe(0.5);
  });

  it('heals nothing when the weekly amount is 0, and up to the cap at the largest amount', () => {
    expect(heal({}, { 'health.condition.recoveryPerCheck': 0 }).value).toBe(80);
    expect(
      heal({ medicalLevel: 3 }, { 'health.condition.recoveryPerCheck': 10 }).value,
    ).toBeCloseTo(93, 10);
    expect(heal({ current: 95 }, { 'health.condition.recoveryPerCheck': 10 }).value).toBe(100);
  });
});

describe('conditionRecoveryValue (POL4-10 fast path)', () => {
  it('matches the traced value over a sweep of parts, ages, traits and care', () => {
    const tunables = createEngineTunables();
    const traitSets = [[], ['durable'], ['injuryProne'], ['durable', 'injuryProne']] as const;
    for (const age of [18, 30, 36, 41, 47, 55, 70]) {
      const cap = computeConditionCap({ age, agingEnabled: true }, { tunables });
      for (const traits of traitSets) {
        for (const medicalLevel of [0, 1, 2, 3] as const) {
          const gain = conditionWeeklyGainValue(
            { traits, medicalLevel, medicalSource: 'Apex Wrestling' },
            { tunables },
          );
          for (const current of [0, 12.34, 49.99, 63.5, 79.875, 85.01, 99.9, 100]) {
            for (const partInjured of [false, true]) {
              const traced = computeConditionRecovery(
                {
                  current,
                  cap,
                  partInjured,
                  traits,
                  medicalLevel,
                  medicalSource: 'Apex Wrestling',
                },
                { tunables },
              );
              expect(conditionRecoveryValue({ current, cap: cap.value, partInjured }, gain)).toBe(
                traced.value,
              );
            }
          }
        }
      }
    }
  });
});
