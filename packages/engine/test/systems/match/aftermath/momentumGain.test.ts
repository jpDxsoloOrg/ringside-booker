// Momentum gain formula (MTCH3-02). Design: docs/design/match-aftermath.md#momentum-gain
import { describe, expect, it } from 'vitest';
import { inputOf } from '../../../../src/core/trace';
import type { TunableOverrides } from '../../../../src/core/tunables/overrides';
import {
  MOMENTUM_GAIN_DOC_REF,
  MOMENTUM_GAIN_LABEL,
  NO_CONTEST_MOMENTUM_NOTE,
  NO_CONTRACT_MOMENTUM_REASON,
  PER_MATCH_LIMIT_LABEL,
  momentumGain,
  momentumTunables,
  noContractMomentum,
  type MomentumGainInputs,
  type MomentumOpponent,
} from '../../../../src/systems/match';
import { createEngineTunables } from '../../../../src/systems/tunables';
import {
  expectSerialisable,
  expectTraceContains,
  expectTraceReplays,
} from '../../../support/trace';

function gain(inputs: MomentumGainInputs, overrides: TunableOverrides = {}) {
  const result = momentumGain(inputs, { tunables: createEngineTunables(overrides) });
  expectTraceReplays(result);
  expectSerialisable(result);
  return result;
}

function opponent(name: string, momentum: number, won = false): MomentumOpponent {
  return { name, momentum: inputOf(`${name}'s momentum`, momentum), won };
}

function match(overrides: Partial<MomentumGainInputs> = {}): MomentumGainInputs {
  return {
    outcome: 'win',
    momentum: inputOf('Own momentum', 20),
    opponents: [opponent('Kara Voss', 20)],
    sides: 2,
    segmentScore: 60,
    ...overrides,
  };
}

const ZERO_TUNABLES: TunableOverrides = Object.fromEntries(
  Object.keys(momentumTunables).map((key) => [key, 0]),
);

describe('momentumGain', () => {
  it('gives 0 for every outcome when every momentum tunable is 0', () => {
    for (const outcome of ['win', 'loss', 'draw', 'noContest'] as const) {
      const result = gain(
        match({
          outcome,
          opponents: [opponent('Kara Voss', 80, outcome === 'loss')],
          sides: 6,
          segmentScore: 99,
        }),
        ZERO_TUNABLES,
      );
      expect(result.value, outcome).toBe(0);
    }
  });

  it('gives +5 for a win against an equal', () => {
    const result = gain(match());
    expect(result.value).toBe(5);
    expect(result.trace.label).toBe(MOMENTUM_GAIN_LABEL);
    expect(result.trace.docRef).toBe(MOMENTUM_GAIN_DOC_REF);
    expect(expectTraceContains(result, { kind: 'tunable', label: 'Win' }).key).toBe(
      'match.momentum.winBase',
    );
    expectTraceContains(result, { kind: 'note', label: 'No hotter opponent beaten' });
  });

  it('caps a win over an opponent 50 hotter at +15 with the win limit line', () => {
    const result = gain(match({ opponents: [opponent('Kara Voss', 70), opponent('Ash', 10)] }));
    expect(result.value).toBe(15);
    expectTraceContains(result, { kind: 'add', label: 'Beat a hotter opponent (gap 50)' });
    expectTraceContains(result, { kind: 'min', label: 'Most one win can give' });
    const capped = gain(match({ opponents: [opponent('Kara Voss', 90)] }));
    expect(capped.value).toBe(15);
    expect(
      expectTraceContains(capped, { kind: 'min', label: 'Most one win can give' }).applied,
    ).toBe(true);
  });

  it('takes 5 for a loss to an equal', () => {
    const result = gain(match({ outcome: 'loss', opponents: [opponent('Kara Voss', 20, true)] }));
    expect(result.value).toBe(-5);
    expectTraceContains(result, { kind: 'note', label: 'No colder opponent lost to' });
  });

  it('takes 13 for a loss to a winner 40 points colder', () => {
    const result = gain(
      match({
        outcome: 'loss',
        momentum: inputOf('Own momentum', 50),
        opponents: [opponent('Kara Voss', 10, true)],
      }),
    );
    expect(result.value).toBeCloseTo(-13, 10);
    expectTraceContains(result, { kind: 'subtract', label: 'Lost to a colder opponent (gap 40)' });
  });

  it('measures a loss against the coldest winner, not a colder fellow loser', () => {
    const result = gain(
      match({
        outcome: 'loss',
        momentum: inputOf('Own momentum', 50),
        opponents: [opponent('Winner', 40, true), opponent('Other loser', -50)],
        sides: 3,
      }),
    );
    // −5 − 0.2 × 10 = −7, then × max(0.35, 2/3).
    expect(result.value).toBeCloseTo((-7 * 2) / 3, 10);
  });

  it('scales a 4-way loss by 0.5 and floors a 10-way loss at a 0.35 share', () => {
    const fourWay = gain(
      match({ outcome: 'loss', opponents: [opponent('Kara Voss', 20, true)], sides: 4 }),
    );
    expect(fourWay.value).toBe(-2.5);
    expectTraceContains(fourWay, { kind: 'multiply', label: 'Lost a 4-way match' });

    const tenWay = gain(
      match({ outcome: 'loss', opponents: [opponent('Kara Voss', 20, true)], sides: 10 }),
    );
    expect(tenWay.value).toBeCloseTo(-1.75, 10);
    expect(
      expectTraceContains(tenWay, { kind: 'max', label: 'Smallest share of a loss kept' }).applied,
    ).toBe(true);
  });

  it('adds 2 for winning a 4-way match', () => {
    const result = gain(match({ sides: 4 }));
    expect(result.value).toBe(7);
    expectTraceContains(result, { kind: 'add', label: 'Won a 4-way match' });
  });

  it('takes 2 for a draw', () => {
    expect(gain(match({ outcome: 'draw' })).value).toBe(-2);
  });

  it('adds the great match bonus to a loss, from a score of 85', () => {
    const loss = match({ outcome: 'loss', opponents: [opponent('Kara Voss', 20, true)] });
    expect(gain({ ...loss, segmentScore: 84 }).value).toBe(-5);
    const great = gain({ ...loss, segmentScore: 85 });
    expect(great.value).toBe(-3);
    expectTraceContains(great, { kind: 'add', label: 'Great match bonus' });
    const unrated = gain({ ...loss, segmentScore: null });
    expect(unrated.value).toBe(-5);
    expectTraceContains(unrated, { kind: 'note', label: 'Not rated: no great match bonus' });
  });

  it('changes nothing for a no contest, even a great one', () => {
    const result = gain(
      match({ outcome: 'noContest', opponents: [opponent('Kara Voss', 90)], segmentScore: 99 }),
    );
    expect(result.value).toBe(0);
    expectTraceContains(result, { kind: 'note', label: NO_CONTEST_MOMENTUM_NOTE });
    expect(result.trace.children?.some((node) => node.kind === 'add')).toBe(false);
  });

  it('keeps the total within the per-match limit after the bonus', () => {
    const result = gain(match({ opponents: [opponent('Kara Voss', 90)], segmentScore: 95 }));
    expect(result.value).toBe(15);
    expect(
      expectTraceContains(result, { kind: 'clamp', label: PER_MATCH_LIMIT_LABEL }).applied,
    ).toBe(true);
    const tight = gain(match(), { 'match.momentum.maxPerSegment': 3 });
    expect(tight.value).toBe(3);
    const tightLoss = gain(
      match({ outcome: 'loss', opponents: [opponent('Kara Voss', 20, true)] }),
      { 'match.momentum.maxPerSegment': 3 },
    );
    expect(tightLoss.value).toBe(-3);
  });

  it('counts an opponent with no contract here as 0, with the reason in the trace', () => {
    const result = gain(
      match({
        momentum: inputOf('Own momentum', -20),
        opponents: [{ name: 'Guest', momentum: noContractMomentum('Guest'), won: false }],
      }),
    );
    // Gap 20: 5 + 4.
    expect(result.value).toBe(9);
    expectTraceContains(result, { kind: 'constant', label: "Guest's momentum" });
    expect(NO_CONTRACT_MOMENTUM_REASON).toMatch(/counts as 0/);
  });
});
