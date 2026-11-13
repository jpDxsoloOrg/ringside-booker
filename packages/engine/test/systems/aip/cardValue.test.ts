// Card value. Design: docs/design/rival-desk.md#card-value
import { describe, expect, it } from 'vitest';
import { findTraceNodes } from '../../../src/core/trace';
import type { TunableOverrides } from '../../../src/core/tunables/overrides';
import {
  CARD_VALUE_GROUPS,
  cardValue,
  defaultTaste,
  NO_MOMENTUM_LABEL,
  noFansNote,
  PRIME_AGE_NOTE,
  storedTaste,
  type CardValueInputs,
  type Taste,
} from '../../../src/systems/aip';
import {
  cardValueFanBase,
  cardValueNumber,
  NO_TASTE_NOTE,
  NO_WEIGHTS_NOTE,
} from '../../../src/systems/aip/formulas/cardValue';
import { createEngineTunables } from '../../../src/systems/tunables';
import { testId } from '../../support/ids';
import { expectSerialisable, expectTraceContains, expectTraceReplays } from '../../support/trace';
import { attributesOf, popEverywhere, testRegions } from '../workers/push-fixtures';

const PROMOTION = 'Test Promotion A';
const regions = testRegions(3);
const home = testId('region', 1);
const second = testId('region', 2);
const abroad = testId('region', 3);
const tunables = createEngineTunables();

const EVEN_TASTE: Taste = {
  wrestlingFocus: 50,
  entertainmentFocus: 50,
  athleticFocus: 50,
  starFocus: 50,
  talkShare: 50,
  titleFocus: 50,
  youthFocus: 50,
  riskAppetite: 50,
};

/** A prime-age worker with no momentum, popularity 60 and every attribute 40 at an even-taste promotion known at home only. */
function inputsOf(overrides: Partial<CardValueInputs> = {}): CardValueInputs {
  return {
    workerName: 'Test Person 001',
    promotionName: PROMOTION,
    workerPop: popEverywhere(regions, 60),
    promotionPop: { [home]: 50 },
    regions,
    attributes: attributesOf(40),
    momentum: null,
    age: 30,
    taste: storedTaste(EVEN_TASTE),
    ...overrides,
  };
}

function valueOf(inputs: CardValueInputs, overrides: TunableOverrides = {}) {
  const result = cardValue(inputs, { tunables: createEngineTunables(overrides) });
  expectTraceReplays(result);
  expectSerialisable(result);
  return result;
}

describe('cardValue', () => {
  it('averages market popularity and the ability blend at prime age', () => {
    const result = valueOf(inputsOf());
    // (60 + 40) ÷ 2.
    expect(result.value).toBeCloseTo(50, 9);
    expectTraceContains(result, { kind: 'formula', label: `Card value at ${PROMOTION}` });
    expectTraceContains(result, { kind: 'note', label: `Age 30: ${PRIME_AGE_NOTE}` });
    const keys = findTraceNodes(result.trace, 'tunable').map((node) => node.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        'aip.cardValue.marketMinPop',
        'aip.cardValue.popularityWeight',
        'aip.cardValue.abilityWeight',
        'aip.cardValue.declineAge',
        'aip.cardValue.youthAge',
      ]),
    );
  });

  it('counts nothing for popularity when the promotion has no fans', () => {
    const result = valueOf(inputsOf({ promotionPop: {} }));
    expect(result.value).toBeCloseTo(20, 9);
    expectTraceContains(result, { kind: 'note', label: noFansNote(PROMOTION) });
  });

  it('counts only the one market', () => {
    const result = valueOf(
      inputsOf({
        workerPop: { [home]: 80, [second]: 10 },
        promotionPop: { [home]: 50, [second]: 5 },
      }),
    );
    // The second region is under the 10-point market minimum, so only home counts: (80 + 40) ÷ 2.
    expect(result.value).toBeCloseTo(60, 9);
    expectTraceContains(result, { kind: 'note', label: /^Markets: 1 region where/ });
  });

  it('widens to every region the promotion is known in when none reaches the minimum', () => {
    const result = valueOf(
      inputsOf({
        workerPop: { [home]: 80, [second]: 20 },
        promotionPop: { [home]: 5, [second]: 5 },
      }),
    );
    expectTraceContains(result, { kind: 'note', label: /has not reached 10 popularity anywhere/ });
    expect(result.value).toBeGreaterThan(20);
  });

  it('scores a star abroad on ability only', () => {
    const result = valueOf(inputsOf({ workerPop: { [abroad]: 100 } }));
    expect(result.value).toBeCloseTo(20, 9);
  });

  it('gives a blend of 0 when every taste weight is 0', () => {
    const zero = storedTaste({
      ...EVEN_TASTE,
      wrestlingFocus: 0,
      entertainmentFocus: 0,
      athleticFocus: 0,
      starFocus: 0,
    });
    const result = valueOf(inputsOf({ taste: zero }));
    expect(result.value).toBeCloseTo(30, 9);
    expectTraceContains(result, { kind: 'note', label: NO_TASTE_NOTE });
  });

  it('gives 0 when both weights are 0', () => {
    const result = valueOf(inputsOf(), {
      'aip.cardValue.popularityWeight': 0,
      'aip.cardValue.abilityWeight': 0,
    });
    expect(result.value).toBe(0);
    expectTraceContains(result, { kind: 'note', label: NO_WEIGHTS_NOTE });
  });

  it('adds nothing for momentum while it is null, and momentum × factor once set', () => {
    const none = valueOf(inputsOf());
    expectTraceContains(none, { kind: 'note', label: `${NO_MOMENTUM_LABEL}: +0` });
    const some = valueOf(inputsOf({ momentum: 30 }));
    expect(some.value - none.value).toBeCloseTo(3, 9);
    const falling = valueOf(inputsOf({ momentum: -20 }));
    expect(falling.value - none.value).toBeCloseTo(-2, 9);
  });

  it('starts the decline one year past the decline age', () => {
    const atAge = valueOf(inputsOf({ age: 36 }));
    expect(atAge.value).toBeCloseTo(50, 9);
    const over = valueOf(inputsOf({ age: 37 }));
    expect(over.value).toBeCloseTo(50 * 0.96, 9);
    expectTraceContains(over, { kind: 'formula', label: 'Age factor' });
  });

  it('never lets age take more than the floor allows', () => {
    const result = valueOf(inputsOf({ age: 60 }));
    expect(result.value).toBeCloseTo(25, 9);
    const floor = expectTraceContains(result, { kind: 'max', label: 'Never below the age floor' });
    expect(floor.applied).toBe(true);
  });

  it('gives the youth bonus under the youth age only', () => {
    const young = valueOf(inputsOf({ age: 25 }));
    // Youth focus 50 ÷ 100 × 6.
    expect(young.value).toBeCloseTo(53, 9);
    expectTraceContains(young, { kind: 'formula', label: 'Youth bonus' });
    const atAge = valueOf(inputsOf({ age: 26 }));
    expect(atAge.value).toBeCloseTo(50, 9);
  });

  it('keeps the value at 100 or less', () => {
    const result = valueOf(
      inputsOf({
        workerPop: popEverywhere(regions, 100),
        attributes: attributesOf(100),
        momentum: 100,
      }),
    );
    expect(result.value).toBe(100);
    const clamp = expectTraceContains(result, { kind: 'clamp' });
    expect(clamp.applied).toBe(true);
  });

  it('blends attributes by the taste, so a stored taste changes the blend', () => {
    const technician = attributesOf(30, { ringwork: 90, psychology: 90, stamina: 90, safety: 90 });
    const style = valueOf(
      inputsOf({
        attributes: technician,
        taste: defaultTaste({ style: 'hardHitting' }, { tunables }),
      }),
    );
    expectTraceContains(style, {
      kind: 'add',
      label: 'Ring work group 90 × Style taste: Hard-hitting 80',
    });
    const talkers = storedTaste({ ...EVEN_TASTE, wrestlingFocus: 10, entertainmentFocus: 100 });
    const stored = valueOf(inputsOf({ attributes: technician, taste: talkers }));
    expectTraceContains(stored, { kind: 'add', label: 'Ring work group 90 × Booker taste 10' });
    expect(stored.value).toBeLessThan(style.value);
  });

  it('never subtracts for a style the promotion does not favour', () => {
    const result = valueOf(inputsOf({ taste: defaultTaste({ style: 'technical' }, { tunables }) }));
    const blend = expectTraceContains(result, {
      kind: 'formula',
      label: `Ability as ${PROMOTION} sees it`,
    });
    const lines = findTraceNodes(blend, 'add');
    expect(lines.length).toBeGreaterThanOrEqual(CARD_VALUE_GROUPS.length);
    for (const line of lines) {
      expect(line.operand).toBeGreaterThanOrEqual(0);
    }
    expect(findTraceNodes(blend, 'subtract')).toEqual([]);
  });
});

describe('cardValueNumber', () => {
  /** A small fixed-seed generator, so the sweep is the same on every run. */
  function generator(seed: number): () => number {
    let state = seed;
    return () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    };
  }

  it('gives exactly the traced value, to the bit, across a sweep of workers and tunables', () => {
    const next = generator(7);
    const pick = (low: number, high: number) => low + next() * (high - low);
    const whole = (low: number, high: number) => Math.floor(pick(low, high + 1));
    const many = testRegions(9);
    const popOf = (zeroChance: number) =>
      Object.fromEntries(
        many.flatMap((region) =>
          next() < zeroChance ? [] : [[region.id, Math.round(pick(0.5, 100) * 10) / 10]],
        ),
      );
    for (let index = 0; index < 400; index += 1) {
      const overrides: TunableOverrides = {
        'aip.cardValue.marketMinPop': whole(0, 60),
        'aip.cardValue.popularityWeight': index % 17 === 0 ? 0 : pick(0, 3),
        'aip.cardValue.abilityWeight': index % 23 === 0 ? 0 : pick(0, 3),
        'aip.cardValue.momentumFactor': pick(0, 1),
        'aip.cardValue.declineAge': whole(18, 60),
        'aip.cardValue.declinePerYear': pick(0, 0.2),
        'aip.cardValue.ageFloor': pick(0, 1),
        'aip.cardValue.youthAge': whole(16, 40),
        'aip.cardValue.youthBonus': pick(0, 20),
      };
      const taste: Taste = {
        wrestlingFocus: index % 5 === 0 ? 0 : whole(0, 100),
        entertainmentFocus: whole(0, 100),
        athleticFocus: index % 7 === 0 ? 0 : whole(0, 100),
        starFocus: whole(0, 100),
        talkShare: whole(0, 100),
        titleFocus: whole(0, 100),
        youthFocus: whole(0, 100),
        riskAppetite: whole(0, 100),
      };
      const deps = { tunables: createEngineTunables(overrides) };
      const inputs = inputsOf({
        workerPop: popOf(0.3),
        promotionPop: index % 11 === 0 ? {} : popOf(0.5),
        regions: many,
        attributes: attributesOf(whole(1, 100), {
          mic: whole(1, 100),
          stamina: whole(1, 100),
          presence: whole(1, 100),
        }),
        momentum: index % 3 === 0 ? null : whole(-100, 100),
        age: whole(16, 60),
        taste: index % 2 === 0 ? storedTaste(taste) : defaultTaste({ style: 'hardHitting' }, deps),
      });
      const traced = cardValue(inputs, deps).value;
      expect(cardValueNumber(inputs, deps)).toBe(traced);
      expect(cardValueNumber(inputs, deps, { fanBase: cardValueFanBase(inputs, deps) })).toBe(
        traced,
      );
    }
  });
});
