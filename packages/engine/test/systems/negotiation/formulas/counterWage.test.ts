// Counter-offer money and the counter-offer composer (ECO5-03).
// Design: docs/design/negotiation.md#counter
import { describe, expect, it } from 'vitest';
import { cents } from '../../../../src/core/money';
import { RngRegistry, type RngStream } from '../../../../src/core/rng/registry';
import { inputOf } from '../../../../src/core/trace/helpers';
import type { TunableOverrides } from '../../../../src/core/tunables/overrides';
import {
  COUNTER_STREAM,
  counterConcession,
  counterTermsFor,
  counterWage,
  type AskingTerms,
} from '../../../../src/systems/negotiation';
import { createEngineTunables } from '../../../../src/systems/tunables';
import { anOffer } from '../../../support';
import {
  expectRollRecorded,
  expectSerialisable,
  expectTraceContains,
  expectTraceReplays,
} from '../../../support/trace';

function stream(seed: string): RngStream {
  return new RngRegistry(seed).stream(COUNTER_STREAM);
}

function counter(
  offered: number,
  asked: number,
  round: number,
  options: { seed?: string; overrides?: TunableOverrides; quotedIn?: 'hundreds' | 'tens' } = {},
) {
  const result = counterWage(
    {
      offered,
      asked,
      round,
      ...(options.quotedIn === undefined ? {} : { quotedIn: options.quotedIn }),
    },
    { tunables: createEngineTunables(options.overrides ?? {}), rng: stream(options.seed ?? 'c') },
  );
  expectTraceReplays(result);
  return result;
}

describe('counterConcession', () => {
  it('gives 30% to 45% of the gap in the first round, with the roll in the Why?', () => {
    for (let index = 0; index < 40; index += 1) {
      const concession = counterConcession(1, {
        tunables: createEngineTunables(),
        rng: stream(`first-${String(index)}`),
      });
      expectTraceReplays(concession);
      expectRollRecorded(concession, COUNTER_STREAM);
      expect(concession.value).toBeGreaterThanOrEqual(0.3);
      expect(concession.value).toBeLessThan(0.45);
      expect(concession.trace.label).toBe(
        `Meets you ${String(Math.round(concession.value * 100))}% of the way`,
      );
    }
  });

  it('gives less in round 3 than in round 1 with the same roll, and nothing from round 5', () => {
    const tunables = createEngineTunables();
    const first = counterConcession(1, { tunables, rng: stream('same') });
    const third = counterConcession(3, { tunables, rng: stream('same') });
    expectTraceReplays(third);
    expect(third.value).toBeCloseTo(first.value * 0.5, 10);
    expect(counterConcession(5, { tunables, rng: stream('same') }).value).toBe(0);
    expect(counterConcession(9, { tunables, rng: stream('same') }).value).toBe(0);
  });
});

describe('counterWage', () => {
  it('lands between the offer and the ask, rounded to $100', () => {
    for (let index = 0; index < 40; index += 1) {
      const result = counter(2_400_000, 4_000_000, 1, { seed: `range-${String(index)}` });
      expect(result.value).toBeGreaterThan(2_400_000);
      expect(result.value).toBeLessThanOrEqual(4_000_000);
      expect(result.value % 10_000).toBe(0);
    }
  });

  it('rounds fees to $10', () => {
    const result = counter(30_000, 50_000, 1, { quotedIn: 'tens' });
    expect(result.value % 1_000).toBe(0);
    expect(result.value).toBeGreaterThan(30_000);
    expect(result.value).toBeLessThan(50_000);
  });

  it('never goes below the offer nor above the ask', () => {
    // An offer above the ask stands.
    expect(counter(5_000_000, 4_000_000, 1).value).toBe(5_000_000);
    // Rounding never pushes past either end.
    expect(counter(3_999_950, 4_000_000, 1).value).toBe(4_000_000);
    const giveAll = { 'contracts.counter.concession': 1, 'contracts.counter.concessionSpread': 0 };
    expect(counter(2_000_040, 4_000_000, 1, { overrides: giveAll }).value).toBe(2_000_040);
    const at = counter(4_000_000, 4_000_000, 1);
    expect(at.value).toBe(4_000_000);
    expectTraceContains(at, { kind: 'max', label: 'Never less than your offer' });
  });

  it('gives less ground in round 3 than in round 1', () => {
    const first = counter(2_000_000, 4_000_000, 1, { seed: 'rounds' });
    const third = counter(2_000_000, 4_000_000, 3, { seed: 'rounds' });
    expect(third.value).toBeGreaterThan(first.value);
    expect(counter(2_000_000, 4_000_000, 5, { seed: 'rounds' }).value).toBe(4_000_000);
  });

  it('is the same counter for the same seed', () => {
    expect(counter(2_000_000, 4_000_000, 2, { seed: 'again' }).value).toBe(
      counter(2_000_000, 4_000_000, 2, { seed: 'again' }).value,
    );
  });

  it('repeats the ask with no concession at all', () => {
    const none = { 'contracts.counter.concession': 0, 'contracts.counter.concessionSpread': 0 };
    expect(counter(2_000_000, 4_000_000, 1, { overrides: none }).value).toBe(4_000_000);
  });
});

function anAsk(overrides: Partial<AskingTerms> = {}): AskingTerms {
  const money = (label: string, value: number) => inputOf(label, value);
  return {
    personId: 'per_1',
    promotionId: 'pro_1',
    role: 'wrestler',
    kind: 'written',
    exclusive: true,
    renewalOf: null,
    marketValue: money('Market value', 4_000_000),
    monthlyWage: money('Monthly wage', 4_000_000),
    perAppearanceFee: money('Fee', 120_000),
    signingBonus: money('Signing bonus', 4_000_000),
    perks: [{ term: 'perk.travelCovered', label: 'Travel covered', reason: 'Lives abroad' }],
    appearanceCap: null,
    preferredLengthMonths: inputOf('Preferred length', 24),
    expectedPush: inputOf('Expected push', 'upperCard'),
    allowedKinds: [],
    bestKind: 'written',
    exclusiveAllowed: true,
    exclusiveReasons: [],
    startPatience: inputOf('Patience', 3),
    refusal: null,
    renewalDecision: null,
    ...overrides,
  } as AskingTerms;
}

describe('counterTermsFor', () => {
  it('moves the money by one roll, adds the perks they want, raises the push and fixes the length', () => {
    const offer = anOffer({
      terms: { monthlyWage: cents(2_000_000), signingBonus: cents(1_000_000) },
      lengthMonths: 60,
      push: 'lowerCard',
      brand: { kind: 'shared' },
    });
    const rng = stream('compose');
    const { offer: reply, trace } = counterTermsFor(offer, anAsk(), 1, createEngineTunables(), rng);
    expectSerialisable(trace);
    expect(trace).toMatchObject({
      kind: 'decision',
      label: 'Their counter-offer',
      chosen: 'counter',
    });

    // One concession for every amount: both moved the same share of their gap (before rounding).
    const wageShare = (4_000_000 - reply.terms.monthlyWage) / 2_000_000;
    const bonusShare = (4_000_000 - reply.terms.signingBonus) / 3_000_000;
    expect(Math.abs(wageShare - bonusShare)).toBeLessThan(0.01);
    expect(reply.terms.perAppearanceFee).toBe(0);
    expect(reply.terms.perks.travelCovered).toBe(true);
    expect(reply.push).toBe('upperCard');
    expect(reply.lengthMonths).toBe(24);
    // Everything else as offered.
    expect(reply.role).toBe(offer.role);
    expect(reply.brand).toEqual(offer.brand);
    expect(reply.startsOn).toBe(offer.startsOn);
    expect(reply.terms.exclusive).toBe(offer.terms.exclusive);
    // The same seed gives the same counter.
    expect(
      counterTermsFor(offer, anAsk(), 1, createEngineTunables(), stream('compose')).offer,
    ).toEqual(reply);
  });

  it('keeps a length within the tolerance and a push above the expected one', () => {
    const offer = anOffer({
      lengthMonths: 30,
      push: 'mainEvent',
      terms: { monthlyWage: cents(5_000_000), signingBonus: cents(5_000_000) },
    });
    const { offer: reply } = counterTermsFor(
      offer,
      anAsk(),
      2,
      createEngineTunables(),
      stream('keep'),
    );
    expect(reply.lengthMonths).toBe(30);
    expect(reply.push).toBe('mainEvent');
    expect(reply.terms.monthlyWage).toBe(5_000_000);
  });
});
