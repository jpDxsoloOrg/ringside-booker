// Worker performance. Design: docs/design/match-rating.md#worker-performance
import { describe, expect, it } from 'vitest';
import { findTraceNodes } from '../../../../src/core/trace';
import type { TunableOverrides } from '../../../../src/core/tunables/overrides';
import type { RingStyle } from '../../../../src/model/entities/person';
import {
  ALL_WEIGHTS_ZERO_NOTE,
  NON_WRESTLER_LABEL,
  SUITS_MATCH_TYPE_LABEL,
  WORKING_HURT_LABEL,
  workerPerformance,
  type PerformanceAttributeKey,
  type PerformanceAxis,
  type WorkerPerformanceInputs,
} from '../../../../src/systems/match';
import { createEngineTunables } from '../../../../src/systems/tunables';
import {
  expectSerialisable,
  expectTraceContains,
  expectTraceReplays,
} from '../../../support/trace';

function attributesAt(value: number): Record<PerformanceAttributeKey, number> {
  return {
    ringwork: value,
    psychology: value,
    athleticism: value,
    safety: value,
    mic: value,
    charisma: value,
    presence: value,
  };
}

function inputsFor(overrides: Partial<WorkerPerformanceInputs> = {}): WorkerPerformanceInputs {
  return {
    personId: 'per_kade',
    name: 'Kade Morrow',
    axis: 'inRing',
    attributes: attributesAt(70),
    style: 'technician',
    fatigue: 0,
    injured: false,
    styleAffinity: [],
    ...overrides,
  };
}

function perform(
  overrides: Partial<WorkerPerformanceInputs> = {},
  tunableOverrides: TunableOverrides = {},
) {
  const result = workerPerformance(inputsFor(overrides), {
    tunables: createEngineTunables(tunableOverrides),
  });
  expectTraceReplays(result);
  expectSerialisable(result.trace);
  return result;
}

const PROMO_WEIGHTS = { mic: 0.5, charisma: 0.3, presence: 0.2 };
const AXES: readonly PerformanceAxis[] = ['inRing', 'entertainment', 'talk'];

describe('workerPerformance', () => {
  it.each(AXES)('gives 0 for zero attributes on the %s axis', (axis) => {
    const result = perform({ axis, attributes: attributesAt(0), talkWeights: PROMO_WEIGHTS });
    expect(result.value).toBe(0);
  });

  it.each(AXES)('gives 100 for 100 everywhere on the %s axis before penalties', (axis) => {
    const result = perform({ axis, attributes: attributesAt(100), talkWeights: PROMO_WEIGHTS });
    expect(result.value).toBeCloseTo(100, 10);
  });

  it('is the weighted mean of the in-ring attributes', () => {
    const attributes = { ...attributesAt(50), ringwork: 80, psychology: 60, athleticism: 70 };
    // 80 × 0.5 + 60 × 0.2 + 70 × 0.2 + 50 × 0.1 = 71
    expect(perform({ attributes }).value).toBeCloseTo(71, 10);
  });

  it('is the weighted mean of the entertainment attributes', () => {
    const attributes = { ...attributesAt(0), charisma: 80, presence: 60, mic: 50 };
    // 80 × 0.5 + 60 × 0.3 + 50 × 0.2 = 68
    expect(perform({ axis: 'entertainment', attributes }).value).toBeCloseTo(68, 10);
  });

  it('uses the angle type weights on the talk axis and labels them with the angle type', () => {
    const attributes = { ...attributesAt(0), mic: 90, charisma: 60, presence: 30 };
    const result = perform({
      axis: 'talk',
      attributes,
      talkWeights: PROMO_WEIGHTS,
      angleTypeName: 'Promo',
      fatigue: 100,
      injured: true,
    });
    // 90 × 0.5 + 60 × 0.3 + 30 × 0.2 = 69; fatigue and injury do not apply to talk.
    expect(result.value).toBeCloseTo(69, 10);
    const micLine = expectTraceContains(result, { kind: 'add', label: /^Mic skills 90/ });
    expect(micLine.reason).toBe('Weight set by Promo');
    expect(findTraceNodes(result.trace, 'tunable')).toHaveLength(0);
  });

  it('refuses the talk axis without the angle type weights', () => {
    expect(() =>
      workerPerformance(inputsFor({ axis: 'talk' }), { tunables: createEngineTunables() }),
    ).toThrow(/talkWeights/);
  });

  it('starts with the worker and axis in the title', () => {
    const result = perform({ axis: 'entertainment' });
    expect(result.trace.label).toBe('Kade Morrow: Entertainment');
    expect(result.trace.kind === 'formula' && result.trace.docRef).toBe(
      'match-rating.md#worker-performance',
    );
  });

  it('gives 0 with a note when every weight is 0', () => {
    const result = perform(
      {},
      {
        'match.perf.inRing.ringwork': 0,
        'match.perf.inRing.psychology': 0,
        'match.perf.inRing.athleticism': 0,
        'match.perf.inRing.safety': 0,
      },
    );
    expect(result.value).toBe(0);
    expectTraceContains(result, { kind: 'note', label: ALL_WEIGHTS_ZERO_NOTE });
  });

  it('gives 0 with a note when the angle type weights are all 0', () => {
    const result = perform({
      axis: 'talk',
      talkWeights: { mic: 0, charisma: 0, presence: 0 },
    });
    expect(result.value).toBe(0);
    expectTraceContains(result, { kind: 'note', label: ALL_WEIGHTS_ZERO_NOTE });
  });

  it('leaves out an attribute whose weight is 0', () => {
    const attributes = { ...attributesAt(60), safety: 0 };
    const result = perform({ attributes }, { 'match.perf.inRing.safety': 0 });
    expect(result.value).toBeCloseTo(60, 10);
  });

  describe('style', () => {
    it('adds the bonus when the style suits the match type', () => {
      const styleAffinity: readonly RingStyle[] = ['technician', 'highFlyer'];
      const result = perform({ styleAffinity });
      expect(result.value).toBeCloseTo(73, 10);
      expect(
        expectTraceContains(result, { kind: 'branch', label: SUITS_MATCH_TYPE_LABEL }).taken,
      ).toBe(true);
    });

    it('adds nothing when the style does not suit it', () => {
      const result = perform({ styleAffinity: ['highFlyer'] });
      expect(result.value).toBeCloseTo(70, 10);
      expect(
        expectTraceContains(result, { kind: 'branch', label: SUITS_MATCH_TYPE_LABEL }).taken,
      ).toBe(false);
    });

    it('takes the non-wrestler penalty', () => {
      const result = perform({ style: 'nonWrestler' });
      expect(result.value).toBeCloseTo(50, 10);
      expect(expectTraceContains(result, { kind: 'branch', label: NON_WRESTLER_LABEL }).taken).toBe(
        true,
      );
    });

    it('applies neither on the entertainment axis', () => {
      const result = perform({
        axis: 'entertainment',
        style: 'nonWrestler',
        styleAffinity: ['nonWrestler'],
      });
      expect(result.value).toBeCloseTo(70, 10);
    });

    it('turns both off at 0', () => {
      const result = perform(
        { style: 'nonWrestler', styleAffinity: ['nonWrestler'] },
        { 'match.perf.styleAffinityBonus': 0, 'match.perf.nonWrestlerPenalty': 0 },
      );
      expect(result.value).toBeCloseTo(70, 10);
    });

    it('applies the bonus at its maximum', () => {
      const result = perform(
        { styleAffinity: ['technician'] },
        { 'match.perf.styleAffinityBonus': 50 },
      );
      expect(result.value).toBe(100);
    });
  });

  describe('fatigue', () => {
    it('costs 15 at fatigue 100 and the default rate', () => {
      expect(perform({ fatigue: 100 }).value).toBeCloseTo(55, 10);
      expect(perform({ axis: 'entertainment', fatigue: 100 }).value).toBeCloseTo(55, 10);
    });

    it('costs nothing at rate 0 and 100 at rate 1', () => {
      expect(
        perform({ fatigue: 100 }, { 'match.perf.fatiguePenaltyPerPoint': 0 }).value,
      ).toBeCloseTo(70, 10);
      expect(perform({ fatigue: 100 }, { 'match.perf.fatiguePenaltyPerPoint': 1 }).value).toBe(0);
    });
  });

  describe('injury', () => {
    it('costs 25 for working hurt', () => {
      const result = perform({ injured: true });
      expect(result.value).toBeCloseTo(45, 10);
      expect(expectTraceContains(result, { kind: 'branch', label: WORKING_HURT_LABEL }).taken).toBe(
        true,
      );
    });

    it('does not apply to entertainment', () => {
      expect(perform({ axis: 'entertainment', injured: true }).value).toBeCloseTo(70, 10);
    });

    it('costs nothing at 0', () => {
      expect(perform({ injured: true }, { 'match.perf.injuredPenalty': 0 }).value).toBeCloseTo(
        70,
        10,
      );
    });
  });

  describe('clamp', () => {
    it('never goes below 0', () => {
      const result = perform({
        attributes: attributesAt(10),
        style: 'nonWrestler',
        injured: true,
        fatigue: 100,
      });
      expect(result.value).toBe(0);
      expect(expectTraceContains(result, { kind: 'clamp' }).applied).toBe(true);
    });

    it('never goes above 100', () => {
      const result = perform({ attributes: attributesAt(100), styleAffinity: ['technician'] });
      expect(result.value).toBe(100);
      expect(expectTraceContains(result, { kind: 'clamp' }).applied).toBe(true);
    });

    it('records the clamp when it does not bite', () => {
      expect(expectTraceContains(perform(), { kind: 'clamp' }).applied).toBe(false);
    });
  });
});
