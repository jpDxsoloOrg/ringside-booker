// Angle aftermath formulas (MTCH5-06): momentum and popularity by share of the beats.
// Design: docs/design/angle-rating.md#angle-aftermath
import { describe, expect, it } from 'vitest';
import type { TunableOverrides } from '../../../../src/core/tunables/overrides';
import {
  ANGLE_AFTERMATH_DOC_REF,
  ANGLE_MOMENTUM_GAIN_LABEL,
  ANGLE_POPULARITY_GAIN_LABEL,
  IN_NO_BEAT_TEXT,
  NEVER_A_LOSS_LABEL,
  angleMomentumGain,
  anglePopularityGain,
  angleShare,
  type AngleGainInputs,
} from '../../../../src';
import { createEngineTunables } from '../../../../src/systems/tunables';
import {
  expectSerialisable,
  expectTraceContains,
  expectTraceReplays,
} from '../../../support/trace';

type Formula = typeof angleMomentumGain;

function run(formula: Formula, inputs: AngleGainInputs, overrides: TunableOverrides = {}) {
  const result = formula(inputs, { tunables: createEngineTunables(overrides) });
  expectTraceReplays(result);
  expectSerialisable(result);
  return result;
}

function angle(overrides: Partial<AngleGainInputs> = {}): AngleGainInputs {
  return { personName: 'Kai Moreno', beatsIn: 2, totalBeats: 2, score: 80, ...overrides };
}

describe('angleShare', () => {
  it('is beats in over beats that ran', () => {
    expect(angleShare({ personName: 'Kai', beatsIn: 1, totalBeats: 4 }).value).toBe(0.25);
    expect(angleShare({ personName: 'Kai', beatsIn: 3, totalBeats: 3 }).value).toBe(1);
    expect(angleShare({ personName: 'Kai', beatsIn: 0, totalBeats: 3 }).value).toBe(0);
    expect(angleShare({ personName: 'Kai', beatsIn: 0, totalBeats: 0 }).value).toBe(0);
  });

  it('refuses more beats in than ran', () => {
    expect(() => angleShare({ personName: 'Kai', beatsIn: 3, totalBeats: 2 })).toThrow();
    expect(() => angleShare({ personName: 'Kai', beatsIn: -1, totalBeats: 2 })).toThrow();
  });
});

describe('angleMomentumGain', () => {
  it('gives (score − 50) × 0.12 for someone in every beat', () => {
    const result = run(angleMomentumGain, angle({ score: 80 }));
    expect(result.value).toBeCloseTo(3.6, 10);
    expect(result.trace.label).toBe(ANGLE_MOMENTUM_GAIN_LABEL);
    expect(result.trace.docRef).toBe(ANGLE_AFTERMATH_DOC_REF);
    expect(
      expectTraceContains(result, { kind: 'tunable', label: 'Score where momentum stays put' }).key,
    ).toBe('match.angle.momentumPivot');
  });

  it('costs a little momentum for a flat angle', () => {
    expect(run(angleMomentumGain, angle({ score: 30 })).value).toBeCloseTo(-2.4, 10);
  });

  it('is 0 exactly at the pivot', () => {
    expect(run(angleMomentumGain, angle({ score: 50 })).value).toBe(0);
  });

  it('scales by share: one beat of four is a quarter', () => {
    expect(run(angleMomentumGain, angle({ beatsIn: 1, totalBeats: 4 })).value).toBeCloseTo(
      0.9,
      10,
    );
  });

  it('gives nothing to someone in no beat (share 0)', () => {
    const result = run(angleMomentumGain, angle({ beatsIn: 0, totalBeats: 3, score: 100 }));
    expect(result.value).toBe(0);
    expect(result.trace).toMatchObject({ kind: 'constant', reason: IN_NO_BEAT_TEXT });
  });

  it('is 0 with the per-point tunable at 0, and largest at its max', () => {
    expect(
      run(angleMomentumGain, angle({ score: 100 }), { 'match.angle.momentumPerPoint': 0 }).value,
    ).toBe(0);
    expect(
      run(angleMomentumGain, angle({ score: 100 }), { 'match.angle.momentumPerPoint': 1 }).value,
    ).toBe(50);
  });

  it('reads the pivot at 0 and 100', () => {
    expect(
      run(angleMomentumGain, angle({ score: 40 }), { 'match.angle.momentumPivot': 0 }).value,
    ).toBeCloseTo(4.8, 10);
    expect(
      run(angleMomentumGain, angle({ score: 40 }), { 'match.angle.momentumPivot': 100 }).value,
    ).toBeCloseTo(-7.2, 10);
  });
});

describe('anglePopularityGain', () => {
  it('gives (score − 60) × 0.05 for someone in every beat', () => {
    const result = run(anglePopularityGain, angle({ score: 80 }));
    expect(result.value).toBeCloseTo(1, 10);
    expect(result.trace.label).toBe(ANGLE_POPULARITY_GAIN_LABEL);
    expect(result.trace.docRef).toBe(ANGLE_AFTERMATH_DOC_REF);
  });

  it('never costs popularity: a flat angle and the pivot itself give 0', () => {
    const flat = run(anglePopularityGain, angle({ score: 20 }));
    expect(flat.value).toBe(0);
    expectTraceContains(flat, { kind: 'max', label: NEVER_A_LOSS_LABEL });
    expect(run(anglePopularityGain, angle({ score: 60 })).value).toBe(0);
    expect(run(anglePopularityGain, angle({ score: 61 })).value).toBeCloseTo(0.05, 10);
  });

  it('scales by share, and gives nothing at share 0', () => {
    expect(run(anglePopularityGain, angle({ beatsIn: 1, totalBeats: 2 })).value).toBeCloseTo(
      0.5,
      10,
    );
    expect(run(anglePopularityGain, angle({ beatsIn: 0, totalBeats: 2 })).value).toBe(0);
  });

  it('reads every tunable at 0 and at its max', () => {
    const top = angle({ score: 100 });
    expect(run(anglePopularityGain, top, { 'match.angle.popularityPerPoint': 0 }).value).toBe(0);
    expect(run(anglePopularityGain, top, { 'match.angle.popularityPerPoint': 1 }).value).toBe(40);
    expect(run(anglePopularityGain, top, { 'match.angle.popularityPivot': 0 }).value).toBe(5);
    expect(run(anglePopularityGain, top, { 'match.angle.popularityPivot': 100 }).value).toBe(0);
  });
});
