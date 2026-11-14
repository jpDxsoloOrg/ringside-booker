// Angle score (MTCH5-03). Design: docs/design/angle-rating.md#angle-score
import { describe, expect, it } from 'vitest';
import { InvalidArgumentError } from '../../../../src/core/errors';
import { RngRegistry } from '../../../../src/core/rng/registry';
import { findTraceNodes, inputOf } from '../../../../src/core/trace';
import type { TunableOverrides } from '../../../../src/core/tunables/overrides';
import {
  ANGLE_SCORE_LABEL,
  ANGLE_STREAM,
  angleScore,
  angleScoreParts,
  CEILING_RAISED_NOTE,
  CLOSING_BEAT_LABEL,
  repeatInAngleLine,
  repeatOnCardLine,
  writingBandLabel,
  type AngleScoreBeat,
  type AngleScoreInputs,
} from '../../../../src/systems/match';
import { createEngineTunables } from '../../../../src/systems/tunables';
import {
  expectSerialisable,
  expectTraceContains,
  expectTraceReplays,
} from '../../../support/trace';

/** Crowd left out, so delivered alone decides the score. */
const BEATS_ONLY: TunableOverrides = { 'match.angle.crowdBlend': 0 };

function beat(
  name: string,
  score: number,
  weight = 1,
  overrides: Partial<AngleScoreBeat> = {},
): AngleScoreBeat {
  return {
    name,
    score: inputOf(`Beat: ${name}`, score),
    weight,
    repetitionGroup: 'talk',
    earlierInAngle: 0,
    earlierOnCard: 0,
    ...overrides,
  };
}

function inputs(beats: readonly AngleScoreBeat[], writingLevel = 5): AngleScoreInputs {
  return {
    beats,
    expected: inputOf('Expected', 50),
    writingLevel,
    entertainment: inputOf('Entertainment', 50),
    starPower: inputOf('Star power', 50),
    typeName: 'Promo',
  };
}

function scoreOf(
  beats: readonly AngleScoreBeat[],
  overrides: TunableOverrides = BEATS_ONLY,
  writingLevel = 5,
) {
  return angleScoreParts(inputs(beats, writingLevel), {
    tunables: createEngineTunables(overrides),
  });
}

/** The worked example: staredown 64, war of words 72, brawl 70. */
const WORKED = [
  beat('Staredown', 64, 0.8, { repetitionGroup: 'faceoff' }),
  beat('War of Words', 72, 1.1),
  beat('Brawl', 70, 1, { repetitionGroup: 'violence' }),
];

describe('angleScore', () => {
  it('rates one beat as its own score, titled "Angle score"', () => {
    const { delivered, score } = scoreOf([beat('Promo', 60)]);
    expect(delivered.value).toBeCloseTo(60, 10);
    expect(score.value).toBe(60);
    expect(score.trace.label).toBe(ANGLE_SCORE_LABEL);
    expectTraceReplays(score);
    expectTraceReplays(delivered);
  });

  it('weights three beats by catalog weight, the closing beat ×1.25', () => {
    const { delivered, score } = scoreOf(WORKED);
    const expected = (0.8 * 64 + 1.1 * 72 + 1.25 * 70) / (0.8 + 1.1 + 1.25);
    expect(delivered.value).toBeCloseTo(expected, 10);
    expect(score.value).toBe(Math.round(expected));
    expectTraceContains(delivered, { kind: 'multiply', label: CLOSING_BEAT_LABEL });
    // Only the last beat gets the closing line.
    expect(
      findTraceNodes(delivered.trace, 'multiply').filter(
        (node) => node.label === CLOSING_BEAT_LABEL,
      ),
    ).toHaveLength(1);
  });

  it('closingBeatWeight 1 treats the last beat like any other; 3 leans on it', () => {
    const flat = scoreOf(WORKED, { ...BEATS_ONLY, 'match.angle.closingBeatWeight': 1 });
    expect(flat.delivered.value).toBeCloseTo((0.8 * 64 + 1.1 * 72 + 70) / 2.9, 10);
    const heavy = scoreOf(WORKED, { ...BEATS_ONLY, 'match.angle.closingBeatWeight': 3 });
    expect(heavy.delivered.value).toBeCloseTo((0.8 * 64 + 1.1 * 72 + 3 * 70) / 4.9, 10);
  });

  it('wears repeated beats down per earlier beat in the angle (default, 1 and 0)', () => {
    const talks = [
      beat('Promo', 60),
      beat('Promo', 60, 1, { earlierInAngle: 1 }),
      beat('Promo', 60, 1, { earlierInAngle: 2 }),
    ];
    const byDefault = scoreOf(talks);
    const weights = [1, 1, 1.25];
    const factors = [1, 0.85, 0.85 ** 2];
    const mean =
      weights.reduce((sum, weight, index) => sum + weight * 60 * (factors[index] ?? 1), 0) / 3.25;
    expect(byDefault.delivered.value).toBeCloseTo(mean, 10);
    expectTraceContains(byDefault.delivered, {
      kind: 'multiply',
      label: repeatInAngleLine('talk', 1, 0.85),
    });
    expect(repeatInAngleLine('talk', 1, 0.85)).toBe('Second talk beat in this angle ×0.85');

    const off = scoreOf(talks, { ...BEATS_ONLY, 'match.angle.repeatFactor': 1 });
    expect(off.delivered.value).toBeCloseTo(60, 10);
    const zero = scoreOf(talks, { ...BEATS_ONLY, 'match.angle.repeatFactor': 0 });
    expect(zero.delivered.value).toBeCloseTo(60 / 3.25, 10);
  });

  it('wears beats down per same-kind beat earlier on the card (default, 1 and 0)', () => {
    const once = [beat('Promo', 80, 1, { earlierOnCard: 1 })];
    const twice = [beat('Promo', 80, 1, { earlierOnCard: 2 })];
    expect(scoreOf([beat('Promo', 80)]).delivered.value).toBeCloseTo(80, 10);
    expect(scoreOf(once).delivered.value).toBeCloseTo(80 * 0.93, 10);
    expect(scoreOf(twice).delivered.value).toBeCloseTo(80 * 0.93 ** 2, 10);
    expectTraceContains(scoreOf(twice).delivered, {
      kind: 'multiply',
      label: repeatOnCardLine('talk', 2, 0.93 ** 2),
    });
    expect(
      scoreOf(twice, { ...BEATS_ONLY, 'match.angle.cardRepeatFactor': 1 }).delivered.value,
    ).toBeCloseTo(80, 10);
    expect(
      scoreOf(twice, { ...BEATS_ONLY, 'match.angle.cardRepeatFactor': 0 }).delivered.value,
    ).toBe(0);
  });

  it('crowdBlend 0 ignores the crowd; 1 takes the crowd alone', () => {
    const beats = [beat('Promo', 60)];
    const tunables = createEngineTunables(BEATS_ONLY);
    const dull = angleScore(
      { ...inputs(beats), entertainment: inputOf('Entertainment', 0) },
      { tunables },
    );
    const lively = angleScore(
      { ...inputs(beats), entertainment: inputOf('Entertainment', 100) },
      { tunables },
    );
    expect(dull.value).toBe(lively.value);

    const crowdOnly = scoreOf(beats, { 'match.angle.crowdBlend': 1 });
    expect(crowdOnly.score.value).toBe(Math.round(crowdOnly.crowd.value));
  });

  it('applies the writing band: writing 0 caps at 75, writing 10 floors at 30', () => {
    const great = scoreOf([beat('Promo', 95)], BEATS_ONLY, 0);
    expect(great.score.value).toBe(75);
    expectTraceContains(great.score, { kind: 'clamp', label: writingBandLabel(0, 0, 75) });

    const weak = scoreOf([beat('Promo', 10)], BEATS_ONLY, 10);
    expect(weak.score.value).toBe(30);
    const band = expectTraceContains(weak.score, {
      kind: 'clamp',
      label: writingBandLabel(10, 30, 100),
    });
    expect(band.applied).toBe(true);
    expect(writingBandLabel(7, 21, 92.5)).toBe('Writing team (level 7): floor 21, ceiling 92.5');
  });

  it('raises a ceiling below the floor to the floor, with a note', () => {
    const { score } = scoreOf(
      [beat('Promo', 90)],
      {
        ...BEATS_ONLY,
        'match.angle.writingCeilingAtZero': 0,
        'match.angle.writingCeilingPerLevel': 0,
      },
      10,
    );
    expect(score.value).toBe(30);
    expectTraceContains(score, { kind: 'note', label: CEILING_RAISED_NOTE });
  });

  it('keeps clamp edges: a score on the floor or ceiling is not moved', () => {
    const onFloor = scoreOf([beat('Promo', 15)]);
    expect(onFloor.score.value).toBe(15);
    const onCeiling = scoreOf([beat('Promo', 87.5)], BEATS_ONLY, 5);
    // 87.5 is the ceiling at writing 5, above the compression knee at 85.
    expect(onCeiling.score.value).toBeLessThan(87.5);
    expect(onCeiling.score.value).toBeGreaterThan(85);
    const band = expectTraceContains(onCeiling.score, {
      kind: 'clamp',
      label: writingBandLabel(5, 15, 87.5),
    });
    expect(band.applied).toBe(false);
    expectTraceContains(onCeiling.score, { kind: 'branch', label: 'Above the knee at 85' });
  });

  it('replays, serialises and gives the same answer twice with the same crowd roll', () => {
    const run = () =>
      angleScoreParts(inputs(WORKED), {
        tunables: createEngineTunables(),
        rng: new RngRegistry('angle-score').stream(ANGLE_STREAM),
      });
    const first = run();
    expect(run()).toEqual(first);
    for (const value of [first.score, first.delivered, first.crowd]) {
      expectTraceReplays(value);
      expectSerialisable(value);
    }
    expect(Number.isInteger(first.score.value)).toBe(true);
  });

  it('throws on no beats or a writing level outside 0..10', () => {
    const tunables = createEngineTunables();
    expect(() => angleScore(inputs([]), { tunables })).toThrow(InvalidArgumentError);
    expect(() => angleScore(inputs([beat('Promo', 50)], 11), { tunables })).toThrow(
      InvalidArgumentError,
    );
  });
});
