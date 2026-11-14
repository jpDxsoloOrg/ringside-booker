// Asking fee (ECO5-02). Design: docs/design/negotiation.md#asking-terms
import { describe, expect, it } from 'vitest';
import { inputOf } from '../../../../src/core/trace/helpers';
import type { TunableOverrides } from '../../../../src/core/tunables/overrides';
import {
  askingFee,
  CURRENT_FEE_FLOOR_LABEL,
  type AskingFeeInputs,
} from '../../../../src/systems/negotiation';
import { createEngineTunables } from '../../../../src/systems/tunables';
import {
  expectSerialisable,
  expectTraceContains,
  expectTraceReplays,
} from '../../../support/trace';

function fee(monthly: number, floor: number | null = null, overrides: TunableOverrides = {}) {
  const inputs: AskingFeeInputs = {
    monthlyAsk: inputOf('Asking wage', monthly),
    currentFeeFloor: floor,
  };
  const result = askingFee(inputs, { tunables: createEngineTunables(overrides) });
  expectTraceReplays(result);
  expectSerialisable(result);
  expect(Number.isInteger(result.value)).toBe(true);
  return result;
}

describe('askingFee', () => {
  it('asks 30% of the monthly ask per appearance, in tens', () => {
    const result = fee(1_234_500);
    // $12,345 × 0.3 = $3,703.50, quoted as $3,700.
    expect(result.value).toBe(370_000);
    expect(result.value % 1_000).toBe(0);
    expectTraceContains(result, {
      kind: 'multiply',
      label: 'Share of the monthly ask per appearance',
    });
    expectTraceContains(result, { kind: 'round', label: 'Fees are quoted in tens' });
  });

  it('asks at least the minimum fee, even for a monthly ask of 0', () => {
    const result = fee(0);
    expect(result.value).toBe(5_000);
    expect(expectTraceContains(result, { kind: 'max', label: 'Least anyone asks' }).applied).toBe(
      true,
    );
    expect(fee(16_666).value).toBe(5_000);
    expect(fee(20_000).value).toBe(6_000);
  });

  it('asks at most the maximum fee', () => {
    const result = fee(40_000_000);
    expect(result.value).toBe(2_000_000);
    expect(expectTraceContains(result, { kind: 'min', label: 'Most anyone asks' }).applied).toBe(
      true,
    );
    expect(fee(6_600_000).value).toBe(1_980_000);
  });

  it('never asks less than their current fee with you, to the cent', () => {
    const result = fee(1_000_000, 300_555);
    expect(result.value).toBe(300_555);
    expect(
      expectTraceContains(result, { kind: 'max', label: CURRENT_FEE_FLOOR_LABEL }).applied,
    ).toBe(true);
    expect(fee(1_000_000, 1).value).toBe(300_000);
  });

  it('treats the tunables at 0 as 0', () => {
    expect(fee(1_000_000, null, { 'contracts.ask.perAppearanceShare': 0 }).value).toBe(5_000);
    expect(
      fee(1_000_000, null, {
        'contracts.ask.perAppearanceShare': 0,
        'contracts.ask.minFee': 0,
      }).value,
    ).toBe(0);
    expect(fee(1_000_000, null, { 'contracts.ask.maxFee': 0 }).value).toBe(0);
  });
});
