// Severance (ECO4-02). Design: docs/design/contracts.md#severance
import { describe, expect, it } from 'vitest';
import { inputOf } from '../../../../src/core/trace/helpers';
import type { TunableOverrides } from '../../../../src/core/tunables/overrides';
import { DAYS_PER_MONTH, severance, type SeveranceInputs } from '../../../../src/systems/contracts';
import { createEngineTunables } from '../../../../src/systems/tunables';
import {
  expectSerialisable,
  expectTraceContains,
  expectTraceReplays,
} from '../../../support/trace';

/** $8,000 a month, 300 days left, an ordinary written deal: the docs' worked example. */
const BASE: SeveranceInputs = {
  kind: 'written',
  monthlyWage: 800_000,
  perAppearanceFee: 0,
  daysOwed: 300,
  ironClad: false,
  started: true,
  morale: 0,
  shareOverride: null,
};

function pay(inputs: Partial<SeveranceInputs> = {}, overrides: TunableOverrides = {}) {
  const result = severance({ ...BASE, ...inputs }, { tunables: createEngineTunables(overrides) });
  expectTraceReplays(result);
  expect(Number.isInteger(result.value)).toBe(true);
  return result;
}

/** The default curve for `months` owed. */
function paidMonths(months: number): number {
  return Math.min(months, 3) + Math.max(0, Math.min(months, 18) - 3) * 0.35;
}

const ALL_ZERO: TunableOverrides = {
  'contracts.severance.fullMonths': 0,
  'contracts.severance.tailRate': 0,
  'contracts.severance.capMonths': 0,
  'contracts.severance.openEndedMonths': 0,
  'contracts.severance.appearancesPerMonth': 0,
  'contracts.severance.ironCladMultiplier': 0,
  'contracts.severance.mutualMorale': 0,
  'contracts.severance.mutualDiscount': 0,
  'contracts.severance.unstartedFactor': 0,
};

describe('severance', () => {
  it('follows the worked example: 300 days at $8,000 a month is $43,197.53', () => {
    const result = pay();
    // 300 ÷ 30.4375 = 9.86 months owed; 3 + 6.86 × 0.35 = 5.40 months paid.
    expect(result.value).toBe(4_319_753);
    expect(result.value).toBe(Math.floor(800_000 * paidMonths(300 / DAYS_PER_MONTH)));
    expect(result.trace).toMatchObject({ label: 'Severance', unit: 'money' });
    expectTraceContains(result, { kind: 'constant', label: 'Average month' });
    expectTraceContains(result, { kind: 'min', label: 'First 3 months in full' });
    expectTraceContains(result, { kind: 'multiply', label: 'Next 6.9 months at 35%' });
    expectSerialisable(result);
  });

  it('is 0 with every tunable at 0', () => {
    for (const inputs of [
      {},
      { daysOwed: null },
      { kind: 'perAppearance' as const, monthlyWage: 0, perAppearanceFee: 50_000 },
      { ironClad: true, morale: -100, started: false },
    ]) {
      expect(pay(inputs, ALL_ZERO).value).toBe(0);
    }
  });

  it('pays every owed month in full while fewer are owed than the full months', () => {
    const days = 45;
    expect(pay({ daysOwed: days }).value).toBe(Math.floor((800_000 * days) / DAYS_PER_MONTH));
    expect(pay({ daysOwed: 0 }).value).toBe(0);
  });

  it('pays nothing for owed months beyond the cap', () => {
    const long = pay({ daysOwed: 1000 });
    // 32.9 months owed, but only 3 + 15 × 0.35 = 8.25 are paid.
    expect(long.value).toBe(6_600_000);
    expect(pay({ daysOwed: 2000 }).value).toBe(long.value);
    expectTraceContains(long, { kind: 'note', label: 'Beyond 18 months: not paid' });
    // A longer deal still costs more than a shorter one below the cap.
    expect(pay({ daysOwed: 400 }).value).toBeGreaterThan(pay({ daysOwed: 300 }).value);
  });

  it('counts an open-ended deal as contracts.severance.openEndedMonths owed', () => {
    const open = pay({ daysOwed: null });
    expect(open.value).toBe(Math.floor(800_000 * paidMonths(6)));
    expectTraceContains(open, { kind: 'branch', label: 'Open-ended contract' });
    expect(pay({ daysOwed: null }, { 'contracts.severance.openEndedMonths': 2 }).value).toBe(
      1_600_000,
    );
  });

  it('values a per-appearance deal at the fee times contracts.severance.appearancesPerMonth', () => {
    const result = pay({ kind: 'perAppearance', monthlyWage: 0, perAppearanceFee: 150_000 });
    expect(result.value).toBe(Math.floor(150_000 * 4 * paidMonths(300 / DAYS_PER_MONTH)));
    expect(
      pay(
        { kind: 'perAppearance', monthlyWage: 0, perAppearanceFee: 150_000 },
        { 'contracts.severance.appearancesPerMonth': 0 },
      ).value,
    ).toBe(0);
  });

  it('multiplies an iron-clad contract by contracts.severance.ironCladMultiplier', () => {
    const plain = pay().value;
    const ironClad = pay({ ironClad: true });
    expect(ironClad.value).toBe(Math.floor(800_000 * paidMonths(300 / DAYS_PER_MONTH) * 2));
    expect(ironClad.value).toBeGreaterThan(plain);
    expectTraceContains(ironClad, { kind: 'multiply', label: 'Iron-clad contract' });
    expect(pay({ ironClad: true }, { 'contracts.severance.ironCladMultiplier': 1 }).value).toBe(
      plain,
    );
  });

  it('discounts a worker who is glad to go, from exactly contracts.severance.mutualMorale', () => {
    const full = pay().value;
    const glad = pay({ morale: -50 });
    expect(glad.value).toBe(Math.floor(800_000 * paidMonths(300 / DAYS_PER_MONTH) * 0.5));
    expectTraceContains(glad, { kind: 'multiply', label: 'Glad to go (morale −50)' });
    expect(pay({ morale: -49 }).value).toBe(full);
    expect(pay({ morale: -62 }, { 'contracts.severance.mutualDiscount': 0 }).value).toBe(full);
  });

  it('uses a share override in place of the glad-to-go discount', () => {
    const share = inputOf('Agreed share', 0.25, undefined, 'ratio');
    const result = pay({ morale: -80, shareOverride: share });
    expect(result.value).toBe(Math.floor(800_000 * paidMonths(300 / DAYS_PER_MONTH) * 0.25));
    expectTraceContains(result, { kind: 'multiply', label: 'Agreed share' });
    expect(
      result.trace.children?.some((node) => node.label.startsWith('Glad to go')) ?? false,
    ).toBe(false);
  });

  it('charges contracts.severance.unstartedFactor for a deal that has not started', () => {
    expect(pay({ started: false }).value).toBe(
      Math.floor(800_000 * paidMonths(300 / DAYS_PER_MONTH) * 0.5),
    );
    expect(pay({ started: false }, { 'contracts.severance.unstartedFactor': 1 }).value).toBe(
      pay().value,
    );
  });

  it('keeps huge wages in whole cents', () => {
    const result = pay({ monthlyWage: 999_999_999_99, daysOwed: 777, ironClad: true });
    expect(Number.isSafeInteger(result.value)).toBe(true);
    expect(result.value).toBeGreaterThan(0);
  });
});
