// Market value (ECO5-02). Design: docs/design/negotiation.md#market-value
import { describe, expect, it } from 'vitest';
import type { TunableOverrides } from '../../../../src/core/tunables/overrides';
import {
  marketValue,
  MERCH_NOT_TRACKED,
  type MarketValueInputs,
} from '../../../../src/systems/negotiation';
import { createEngineTunables } from '../../../../src/systems/tunables';
import {
  expectSerialisable,
  expectTraceContains,
  expectTraceReplays,
} from '../../../support/trace';

/** The docs' worked example: peak 72, world 31, a 68-rated wrestler. */
const BASE: MarketValueInputs = {
  peakPop: 72,
  worldPop: 31,
  roleRating: 68,
  role: 'wrestler',
  starMerchMonthly: null,
};

function value(inputs: Partial<MarketValueInputs> = {}, overrides: TunableOverrides = {}) {
  const result = marketValue({ ...BASE, ...inputs }, { tunables: createEngineTunables(overrides) });
  expectTraceReplays(result);
  expectSerialisable(result);
  expect(Number.isInteger(result.value)).toBe(true);
  return result;
}

/** The formula by hand, with the default tunables, in cents. */
function byHand(inputs: MarketValueInputs, roleFactor = 1): number {
  const index = 0.7 * inputs.peakPop + 0.3 * inputs.worldPop;
  const popularity = 30_000_000 * (index / 100) ** 2;
  const skill = 1_500_000 * (inputs.roleRating / 100) ** 2;
  return Math.round(
    (popularity + skill + (inputs.starMerchMonthly ?? 0) * 0.25 + 100_000) * roleFactor,
  );
}

describe('marketValue', () => {
  it('follows the worked example and names popularity, skill, base and role', () => {
    const result = value();
    expect(result.value).toBe(byHand(BASE));
    expect(result.value).toBe(11_485_870);
    expect(result.trace).toMatchObject({ label: 'Market value', unit: 'money' });
    expectTraceContains(result, { kind: 'formula', label: 'Popularity (peak 72, world 31)' });
    expectTraceContains(result, { kind: 'add', label: 'Skill as a wrestler' });
    expectTraceContains(result, { kind: 'power', label: 'Curve' });
    expectTraceContains(result, { kind: 'add', label: 'Base' });
    expectTraceContains(result, { kind: 'multiply', label: 'Role: wrestler' });
    const merch = expectTraceContains(result, { kind: 'branch', label: MERCH_NOT_TRACKED });
    expect(merch.taken).toBe(false);
  });

  it('is only the base with every input at 0', () => {
    const result = value({ peakPop: 0, worldPop: 0, roleRating: 0 });
    expect(result.value).toBe(100_000);
  });

  it('tops out at popScale + skillScale + floor with every input at 100', () => {
    const result = value({ peakPop: 100, worldPop: 100, roleRating: 100 });
    expect(result.value).toBe(30_000_000 + 1_500_000 + 100_000);
  });

  it('scales by the role factor', () => {
    const referee = value({ role: 'referee' });
    expect(referee.value).toBe(byHand(BASE, 0.35));
    expectTraceContains(referee, { kind: 'multiply', label: 'Role: referee' });
    expectTraceContains(referee, { kind: 'add', label: 'Skill as a referee' });
    expect(value({ role: 'booker' }).value).toBe(byHand(BASE, 0.8));
  });

  it('adds a share of star merchandise when it is tracked', () => {
    const result = value({ starMerchMonthly: 1_000_000 });
    expect(result.value).toBe(byHand({ ...BASE, starMerchMonthly: 1_000_000 }));
    expectTraceContains(result, { kind: 'add', label: 'Star merchandise' });
  });

  it('treats a tunable at 0 as 0', () => {
    expect(value({}, { 'contracts.value.popScale': 0 }).value).toBe(
      Math.round(1_500_000 * 0.68 ** 2 + 100_000),
    );
    expect(value({}, { 'contracts.value.floor': 0, 'contracts.value.skillScale': 0 }).value).toBe(
      Math.round(30_000_000 * 0.597 ** 2),
    );
    // Breadth 0: only the best country counts.
    expect(value({}, { 'contracts.value.breadthWeight': 0 }).value).toBe(
      Math.round(30_000_000 * 0.72 ** 2 + 1_500_000 * 0.68 ** 2 + 100_000),
    );
    expect(value({}, { 'contracts.value.roleFactor.wrestler': 0 }).value).toBe(0);
    // Exponent 0: the curve is flat, every worker gets the whole scale.
    expect(value({ peakPop: 10, worldPop: 0 }, { 'contracts.value.popExponent': 0 }).value).toBe(
      Math.round(30_000_000 + 1_500_000 * 0.68 ** 2 + 100_000),
    );
  });

  it('rises smoothly: one more point of peak popularity never adds more than popScale × 3 ÷ 100', () => {
    const limit = (30_000_000 * 3) / 100 + 1;
    for (let peak = 0; peak < 100; peak += 1) {
      const step = value({ peakPop: peak + 1 }).value - value({ peakPop: peak }).value;
      expect(step).toBeGreaterThanOrEqual(0);
      expect(step).toBeLessThanOrEqual(limit);
    }
  });
});
