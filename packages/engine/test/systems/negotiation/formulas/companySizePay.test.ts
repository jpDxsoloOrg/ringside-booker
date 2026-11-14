// Company size pay (ECO4-09): small companies pay indie wages.
// Design: docs/design/negotiation.md#asking-terms, docs/design/contracts.md#company-size-pay
import { describe, expect, it } from 'vitest';
import type { TunableOverrides } from '../../../../src/core/tunables/overrides';
import {
  companySizePay,
  companySizePayLabel,
  FULL_RATES_LABEL,
} from '../../../../src/systems/negotiation';
import { createEngineTunables } from '../../../../src/systems/tunables';
import {
  expectSerialisable,
  expectTraceContains,
  expectTraceReplays,
} from '../../../support/trace';

function pay(reach: number, overrides: TunableOverrides = {}) {
  const result = companySizePay(reach, { tunables: createEngineTunables(overrides) });
  expectTraceReplays(result);
  expectSerialisable(result);
  return result;
}

describe('companySizePay', () => {
  it('pays the indie floor at reach 0 and the full rate from the full-rates reach', () => {
    expect(pay(0).value).toBeCloseTo(0.32, 10);
    expect(pay(15).value).toBeCloseTo(0.32 + 0.68 * 0.5, 10);
    expect(pay(30).value).toBeCloseTo(1, 10);
    expect(pay(54).value).toBeCloseTo(1, 10);
    expect(pay(100).value).toBeCloseTo(1, 10);
  });

  it("puts Hardpan's reach (3.6) at about 40% of the usual rate", () => {
    expect(pay(3.6).value).toBeCloseTo(0.4016, 4);
  });

  it('rises smoothly with reach and never jumps at a size threshold', () => {
    for (let reach = 0; reach < 100; reach += 0.5) {
      const step = pay(reach + 0.5).value - pay(reach).value;
      expect(step).toBeGreaterThanOrEqual(0);
      expect(step).toBeLessThanOrEqual((0.68 / 30) * 0.5 + 1e-9);
    }
  });

  it('names the line by the company size and its reach', () => {
    const tunables = createEngineTunables();
    expect(pay(3.6).trace.label).toBe('Company size: Local (reach 4)');
    expect(companySizePayLabel(12.4, tunables)).toBe('Company size: Regional (reach 12)');
    expect(companySizePayLabel(32.1, tunables)).toBe('Company size: National (reach 32)');
    expectTraceContains(pay(3.6), { kind: 'add', label: 'Indie floor' });
  });

  it('pays full rates everywhere when the full-rates reach is 0', () => {
    const result = pay(3.6, { 'contracts.ask.sizeFullReach': 0 });
    expect(result.value).toBe(1);
    expect(expectTraceContains(result, { kind: 'branch', label: FULL_RATES_LABEL }).taken).toBe(
      true,
    );
  });

  it('follows the tunables: a floor of 0 pays nothing at reach 0, a floor of 1 always pays in full', () => {
    expect(pay(0, { 'contracts.ask.sizeFloor': 0 }).value).toBe(0);
    expect(pay(10, { 'contracts.ask.sizeFloor': 0 }).value).toBeCloseTo(1 / 3, 10);
    expect(pay(3.6, { 'contracts.ask.sizeFloor': 1 }).value).toBeCloseTo(1, 10);
    expect(pay(10, { 'contracts.ask.sizeFullReach': 10 }).value).toBeCloseTo(1, 10);
  });
});
