// Monthly medical (ECO1-03). Design: docs/design/finances.md#medical
import { describe, expect, it } from 'vitest';
import type { TunableOverrides } from '../../../../src/core/tunables/overrides';
import {
  MEDICAL_LEVEL_LABELS,
  monthlyMedical,
  type MedicalLevel,
} from '../../../../src/systems/finance';
import { createEngineTunables } from '../../../../src/systems/tunables';
import { expectSerialisable, expectTraceReplays } from '../../../support/trace';

function medical(contracts: number, level: MedicalLevel, overrides: TunableOverrides = {}) {
  return monthlyMedical(
    { contracts, level, levelLabel: MEDICAL_LEVEL_LABELS[level] },
    { tunables: createEngineTunables(overrides) },
  );
}

describe('monthlyMedical', () => {
  it('charges each person under contract the cost of the policy level', () => {
    expect(medical(10, 1).value).toBe(150_000);
    expect(medical(10, 2).value).toBe(600_000);
    expect(medical(10, 3).value).toBe(1_500_000);
    const result = medical(4, 2);
    expect(result.trace.label).toBe('Medical (Good)');
    expect(result.trace.unit).toBe('money/month');
    expectTraceReplays(result);
    expectSerialisable(result.trace);
  });

  it('is 0 at level 0 and for nobody under contract', () => {
    expect(medical(25, 0).value).toBe(0);
    expect(medical(0, 3).value).toBe(0);
    expectTraceReplays(medical(25, 0));
  });

  it('reads the per-person cost from the tunables', () => {
    expect(medical(3, 1, { 'finance.medical.perContract.level1': 20_000 }).value).toBe(60_000);
  });
});
