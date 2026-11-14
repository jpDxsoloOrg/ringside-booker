// Asking wage (ECO5-02). Design: docs/design/negotiation.md#asking-terms
import { describe, expect, it } from 'vitest';
import { inputOf } from '../../../../src/core/trace/helpers';
import type { TunableOverrides } from '../../../../src/core/tunables/overrides';
import {
  askingWage,
  CURRENT_DEAL_FLOOR_LABEL,
  marketValue,
  type AskingWageInputs,
} from '../../../../src/systems/negotiation';
import { createEngineTunables } from '../../../../src/systems/tunables';
import {
  expectSerialisable,
  expectTraceContains,
  expectTraceReplays,
} from '../../../support/trace';

/** $100,000 a month of market value. */
const VALUE = 10_000_000;

const BASE: AskingWageInputs = {
  marketValue: inputOf('Market value', VALUE),
  reach: 82,
  prestige: 60,
  motivation: 'enjoyment',
  traits: [],
  charisma: 50,
  presence: 50,
  role: 'wrestler',
  exclusive: false,
  underContractElsewhere: false,
  renewal: null,
  modifiers: [],
  currentDealFloor: null,
};

function ask(inputs: Partial<AskingWageInputs> = {}, overrides: TunableOverrides = {}) {
  const result = askingWage({ ...BASE, ...inputs }, { tunables: createEngineTunables(overrides) });
  expectTraceReplays(result);
  expectSerialisable(result);
  expect(Number.isInteger(result.value)).toBe(true);
  return result;
}

/** Rounded to the nearest $100, in cents. */
function hundreds(cents: number): number {
  return Math.round(cents / 10_000) * 10_000;
}

/** The ask before rounding with the default reach and image factors, × `extra`. */
function expected(extra = 1, reach = 82, prestige = 60, value = VALUE): number {
  return hundreds(value * (0.25 + 0.75 * (reach / 100)) * (1 - 0.15 * (prestige / 100)) * extra);
}

describe('askingWage', () => {
  it('scales the market value by reach and public image, in hundreds', () => {
    const result = ask();
    expect(result.value).toBe(expected());
    expect(result.value % 10_000).toBe(0);
    expectTraceContains(result, { kind: 'multiply', label: 'Your reach 82' });
    expectTraceContains(result, { kind: 'multiply', label: 'Your public image' });
    expectTraceContains(result, { kind: 'multiply', label: 'Ego premium' });
    expectTraceContains(result, { kind: 'round', label: 'Asks are quoted in hundreds' });
  });

  it('follows the docs worked example: $99,500 exclusive at reach 82 and public image 60', () => {
    const value = marketValue(
      { peakPop: 72, worldPop: 31, roleRating: 68, role: 'wrestler', starMerchMonthly: null },
      { tunables: createEngineTunables({}) },
    );
    const result = ask({ marketValue: value, exclusive: true });
    expect(result.value).toBe(expected(1.1, 82, 60, value.value));
    expect(result.value).toBe(9_950_000);
  });

  it('asks the reach floor at reach 0 and the full value at reach 100 and image 0', () => {
    expect(ask({ reach: 0, prestige: 0 }).value).toBe(hundreds(VALUE * 0.25));
    expect(ask({ reach: 100, prestige: 0 }).value).toBe(VALUE);
    expect(ask({ reach: 100, prestige: 100 }).value).toBe(hundreds(VALUE * 0.85));
  });

  it('is 0 for a market value of 0', () => {
    expect(ask({ marketValue: inputOf('Market value', 0) }).value).toBe(0);
  });

  it('doubles the image discount for a worker who cares about their legacy', () => {
    const result = ask({ motivation: 'legacy' });
    expect(result.value).toBe(hundreds(VALUE * (0.25 + 0.75 * 0.82) * (1 - 0.15 * 2 * 0.6)));
    expect(
      expectTraceContains(result, { kind: 'branch', label: 'Cares about their legacy' }).taken,
    ).toBe(true);
  });

  it('adds the ego premiums, takes off selfless, and limits the total', () => {
    expect(ask({ traits: ['egotist'] }).value).toBe(expected(1.1));
    expect(ask({ motivation: 'money' }).value).toBe(expected(1.1));
    expect(ask({ presence: 80 }).value).toBe(expected(1.1));
    expect(ask({ presence: 79 }).value).toBe(expected());
    expect(ask({ traits: ['selfless'] }).value).toBe(expected(0.95));
    // Egotist + money + star = 0.3, exactly the cap; selfless takes 0.05 off before the cap.
    expect(ask({ traits: ['egotist'], motivation: 'money', charisma: 90 }).value).toBe(
      expected(1.3),
    );
    const capped = ask(
      { traits: ['egotist'], motivation: 'money', charisma: 90 },
      { 'contracts.ask.premiumCap': 0.2 },
    );
    expect(capped.value).toBe(expected(1.2));
    expect(expectTraceContains(capped, { kind: 'min', label: 'Limited to' }).applied).toBe(true);
    // A cap of 0 removes the premiums.
    expect(
      ask({ traits: ['egotist'], motivation: 'money' }, { 'contracts.ask.premiumCap': 0 }).value,
    ).toBe(expected());
  });

  it('adds the exclusive and under-contract premiums', () => {
    expect(ask({ exclusive: true }).value).toBe(expected(1.1));
    expect(ask({ underContractElsewhere: true }).value).toBe(expected(1.1));
    expect(ask({ exclusive: true, underContractElsewhere: true }).value).toBe(expected(1.21));
    expect(ask({ exclusive: true }, { 'contracts.ask.exclusivePremium': 0 }).value).toBe(
      expected(),
    );
  });

  it('asks more to renew while unhappy, from just below the unhappy line', () => {
    const at = ask({ renewal: { morale: -20, loyalToYou: false } });
    expect(at.value).toBe(expected());
    expect(
      expectTraceContains(at, { kind: 'branch', label: 'Morale −20: unhappy here' }).taken,
    ).toBe(false);
    expect(ask({ renewal: { morale: -21, loyalToYou: false } }).value).toBe(expected(1.01));
    const unhappy = ask({ renewal: { morale: -45, loyalToYou: false } });
    expect(unhappy.value).toBe(expected(1.25));
    expectTraceContains(unhappy, { kind: 'multiply', label: 'Morale −45: unhappy here' });
    expect(
      ask(
        { renewal: { morale: -45, loyalToYou: false } },
        { 'contracts.renewal.unhappyPremiumPerPoint': 0 },
      ).value,
    ).toBe(expected());
  });

  it('asks less to stay when loyal', () => {
    const loyal = ask({ renewal: { morale: 10, loyalToYou: true } });
    expect(loyal.value).toBe(expected(0.9));
    expectTraceContains(loyal, { kind: 'multiply', label: 'Loyal to you' });
    // The loyalty discount only applies to a renewal.
    expect(ask({ renewal: null, traits: ['loyal'] }).value).toBe(expected());
  });

  it('applies each modifier as a factor, named by its trace', () => {
    const result = ask({ modifiers: [inputOf('Rapport with your booker', 0.8)] });
    expect(result.value).toBe(expected(0.8));
    expectTraceContains(result, { kind: 'multiply', label: 'Rapport with your booker' });
  });

  it('caps the ask by role', () => {
    const huge = inputOf('Market value', 100_000_000);
    const wrestler = ask({ marketValue: huge, reach: 100, prestige: 0 });
    expect(wrestler.value).toBe(40_000_000);
    expect(
      expectTraceContains(wrestler, { kind: 'min', label: 'Most a wrestler asks for' }).applied,
    ).toBe(true);
    expect(ask({ marketValue: huge, role: 'referee' }).value).toBe(2_000_000);
    expect(ask({ marketValue: huge, role: 'producer' }).value).toBe(4_000_000);
    expect(ask({ marketValue: huge, role: 'booker' }, {}).value).toBe(8_000_000);
    expect(ask({ marketValue: huge }, { 'contracts.ask.cap.wrestler': 0 }).value).toBe(0);
  });

  it('never asks less than their current deal with you, to the cent', () => {
    const floor = expected() + 4_321;
    const result = ask({ currentDealFloor: floor });
    expect(result.value).toBe(floor);
    expect(
      expectTraceContains(result, { kind: 'max', label: CURRENT_DEAL_FLOOR_LABEL }).applied,
    ).toBe(true);
    expect(ask({ currentDealFloor: 100 }).value).toBe(expected());
  });

  it('moves smoothly with reach and public image', () => {
    for (let point = 0; point < 100; point += 1) {
      const reachStep = ask({ reach: point + 1 }).value - ask({ reach: point }).value;
      expect(reachStep).toBeGreaterThanOrEqual(0);
      expect(reachStep).toBeLessThanOrEqual(VALUE * 0.0075 + 10_000);
      const imageStep = ask({ prestige: point }).value - ask({ prestige: point + 1 }).value;
      expect(imageStep).toBeGreaterThanOrEqual(0);
      expect(imageStep).toBeLessThanOrEqual(VALUE * 0.0015 + 10_000);
    }
  });
});
