// Contract value (ECO5-03). Design: docs/design/negotiation.md#contract-value
import { describe, expect, it } from 'vitest';
import { cents } from '../../../../src/core/money';
import type { TunableOverrides } from '../../../../src/core/tunables/overrides';
import type { ContractTerms } from '../../../../src/model/entities/employment';
import {
  contractValue,
  ENFORCEABLE_TERMS,
  notEnforcedLine,
  type ContractValueInputs,
  type EnforceableTerm,
} from '../../../../src/systems/negotiation';
import { createEngineTunables } from '../../../../src/systems/tunables';
import { expectTraceContains, expectTraceReplays } from '../../../support/trace';

const WAGE = 1_000_000; // $10,000 a month

const TERMS: ContractTerms = {
  kind: 'written',
  exclusive: true,
  monthlyWage: cents(WAGE),
  perAppearanceFee: cents(0),
  signingBonus: cents(0),
  shares: { gateBp: 0, merchBp: 0, broadcastBp: 0 },
  appearanceCap: null,
  perks: { creativeControl: false, noHouseShows: false, ironClad: false, travelCovered: false },
};

const ALL_PERKS = {
  creativeControl: true,
  noHouseShows: true,
  ironClad: true,
  travelCovered: true,
};

const EVERYTHING: ReadonlySet<EnforceableTerm> = new Set(ENFORCEABLE_TERMS);
const NOTHING: ReadonlySet<EnforceableTerm> = new Set();

function value(
  overrides: Partial<Omit<ContractValueInputs, 'terms'>> & { terms?: Partial<ContractTerms> } = {},
  tunables: TunableOverrides = {},
) {
  const result = contractValue(
    {
      push: 'midCard',
      expectedPush: 'midCard',
      lengthMonths: 24,
      preferredLengthMonths: 24,
      enforced: EVERYTHING,
      ...overrides,
      terms: { ...TERMS, ...overrides.terms },
    },
    { tunables: createEngineTunables(tunables) },
  );
  expectTraceReplays(result);
  expect(Number.isInteger(result.value)).toBe(true);
  return result;
}

describe('contractValue', () => {
  it('is the monthly wage when nothing else is offered', () => {
    const result = value();
    expect(result.value).toBe(WAGE);
    expect(result.trace).toMatchObject({ label: 'Contract value', unit: 'money/month' });
    expectTraceContains(result, {
      kind: 'branch',
      label: 'Mid card, the card position they expect',
    });
    expectTraceContains(result, { kind: 'branch', label: '24 months, the length they prefer' });
  });

  it('adds every enforced perk premium, and nothing for perks the game does not honour', () => {
    expect(value({ terms: { perks: ALL_PERKS } }).value).toBe(1_380_000);
    const none = value({ terms: { perks: ALL_PERKS }, enforced: NOTHING });
    expect(none.value).toBe(WAGE);
    for (const label of ['Iron-clad', 'Travel covered', 'No house shows', 'Creative control']) {
      const line = expectTraceContains(none, { kind: 'branch', label: notEnforcedLine(label) });
      expect(line.taken).toBe(false);
    }
  });

  it('gives an unenforced perk nothing and says why', () => {
    const enforced = new Set<EnforceableTerm>(['perk.ironClad', 'perk.travelCovered']);
    const result = value({
      terms: { perks: { ...TERMS.perks, creativeControl: true } },
      enforced,
    });
    expect(result.value).toBe(WAGE);
    expectTraceContains(result, {
      kind: 'branch',
      label: 'Creative control: not enforced by the game yet, adds nothing',
    });
    // Iron-clad is honoured: 20% more.
    expect(value({ terms: { perks: { ...TERMS.perks, ironClad: true } }, enforced }).value).toBe(
      1_200_000,
    );
  });

  it('counts revenue shares the game pays and ignores the others', () => {
    const gate = value({ terms: { shares: { gateBp: 500, merchBp: 0, broadcastBp: 0 } } });
    expect(gate.value).toBe(1_100_000);
    const tv = value({
      terms: { shares: { gateBp: 0, merchBp: 0, broadcastBp: 500 } },
      enforced: new Set<EnforceableTerm>(['share.gateBp']),
    });
    expect(tv.value).toBe(WAGE);
    expectTraceContains(tv, {
      kind: 'branch',
      label: 'Share of TV money: not enforced by the game yet, adds nothing',
    });
  });

  it('loses 10% a step below the expected push and gains 3% a step above', () => {
    const below = value({ push: 'lowerCard', expectedPush: 'upperCard' });
    expect(below.value).toBe(810_000);
    expectTraceContains(below, {
      kind: 'multiply',
      label: 'Lower card: 2 steps below the Upper card they expect',
    });
    expect(value({ push: 'upperCard' }).value).toBe(1_030_000);
    // Crew are not pushed, so the card position never counts.
    expect(value({ push: 'mainEvent', expectedPush: 'none' }).value).toBe(WAGE);
  });

  it('loses half a percent a month off the preferred length, down to the floor', () => {
    expect(value({ lengthMonths: 30 }).value).toBe(970_000);
    const floor = value({ lengthMonths: 60 });
    expect(floor.value).toBe(850_000);
    expect(
      expectTraceContains(floor, { kind: 'max', label: 'Least a length counts for' }).applied,
    ).toBe(true);
  });

  it('counts fees for four appearances a month, at most the appearance cap', () => {
    const fees = { monthlyWage: cents(0), perAppearanceFee: cents(50_000) };
    expect(value({ terms: { ...fees, kind: 'perAppearance' } }).value).toBe(200_000);
    expect(value({ terms: { ...fees, appearanceCap: 24 } }).value).toBe(100_000);
    expect(value({ terms: { ...fees, appearanceCap: 120 } }).value).toBe(200_000);
  });

  it('spreads the signing bonus over the contract', () => {
    const result = value({
      terms: { monthlyWage: cents(2_400_000), signingBonus: cents(4_000_000) },
    });
    expect(result.value).toBe(2_566_667);
    expectTraceContains(result, { kind: 'add', label: 'Signing bonus spread over 24 months' });
  });

  it('treats 0 as 0 for every tunable', () => {
    const zero = {
      'contracts.value.perk.ironClad': 0,
      'contracts.value.perk.travelCovered': 0,
      'contracts.value.perk.noHouseShows': 0,
      'contracts.value.perk.creativeControl': 0,
      'contracts.value.sharePerPercent': 0,
      'contracts.value.pushBelowPerStep': 0,
      'contracts.value.lengthMismatchPerMonth': 0,
    };
    expect(
      value(
        {
          terms: { perks: ALL_PERKS, shares: { gateBp: 500, merchBp: 500, broadcastBp: 500 } },
          push: 'enhancement',
          lengthMonths: 60,
        },
        zero,
      ).value,
    ).toBe(WAGE);
    expect(
      value(
        { terms: { monthlyWage: cents(0), perAppearanceFee: cents(50_000) } },
        {
          'contracts.value.appearancesPerMonth': 0,
        },
      ).value,
    ).toBe(0);
    expect(value({ lengthMonths: 25 }, { 'contracts.value.lengthFitMin': 0 }).value).toBe(995_000);
  });
});
