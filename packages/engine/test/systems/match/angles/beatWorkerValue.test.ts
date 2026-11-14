// Beat worker value. Design: docs/design/angle-rating.md#beat-worker-value
import { describe, expect, it } from 'vitest';
import { RngRegistry, type RngStream } from '../../../../src/core/rng/registry';
import { findTraceNodes, type DecisionNode, type Traced } from '../../../../src/core/trace';
import type { TunableOverrides } from '../../../../src/core/tunables/overrides';
import {
  ANGLE_STREAM,
  angleTunables,
  BEST_STAT_LABEL,
  beatWorkerValue,
  NO_MOMENTUM_NOTE,
  NO_NOISE_BRANCH,
  NOT_YOUR_WORKER_NOTE,
  pickBeatStat,
  STAT_NOISE_LABEL,
  type BeatWorkerValueInputs,
} from '../../../../src/systems/match';
import { ALL_TUNABLES, createEngineTunables } from '../../../../src/systems/tunables';
import {
  expectRollRecorded,
  expectSerialisable,
  expectTraceContains,
  expectTraceReplays,
} from '../../../support/trace';

const QUIET: TunableOverrides = { 'match.angle.statNoise': 0 };

function stream(seed = 'beat-worker'): RngStream {
  return new RngRegistry(seed).stream(ANGLE_STREAM);
}

function inputs(overrides: Partial<BeatWorkerValueInputs> = {}): BeatWorkerValueInputs {
  return {
    personName: 'Ava Stone',
    stats: ['mic', 'charisma', 'presence'],
    values: { mic: 78, charisma: 64, presence: 51 },
    morale: 0,
    momentum: 0,
    manager: null,
    managerCanStandIn: true,
    isViewersWorker: true,
    ...overrides,
  };
}

function value(
  given: BeatWorkerValueInputs,
  overrides: TunableOverrides = QUIET,
  rng: RngStream = stream(),
): Traced<number> {
  const result = beatWorkerValue(given, { tunables: createEngineTunables(overrides), rng });
  expectTraceReplays(result);
  expectSerialisable(result);
  return result;
}

function bestStat(result: Traced<number>): DecisionNode {
  return expectTraceContains(result, { kind: 'decision', label: BEST_STAT_LABEL });
}

const REX = { name: 'Rex Halden', values: { mic: 82, charisma: 40 }, morale: 0 };

describe('angle tunables', () => {
  it('declares the MTCH5-02 and MTCH5-03 keys with their defaults and ranges', () => {
    expect(
      Object.fromEntries(
        Object.entries(angleTunables).map(([key, def]) => [key, [def.default, def.min, def.max]]),
      ),
    ).toEqual({
      'match.angle.managerShare': [0.85, 0, 1],
      'match.angle.popularityStatShare': [0.9, 0, 1],
      'match.angle.moralePenaltyMax': [0.15, 0, 0.5],
      'match.angle.momentumPenaltyMax': [0.1, 0, 0.5],
      'match.angle.momentumBonusMax': [0.05, 0, 0.5],
      'match.angle.statNoise': [3, 0, 10],
      'match.angle.beatNoise': [5, 0, 15],
      'match.angle.maxBeats.short': [2, 1, 8],
      'match.angle.maxBeats.standard': [4, 1, 8],
      'match.angle.maxBeats.long': [6, 1, 8],
      'match.angle.closingBeatWeight': [1.25, 1, 3],
      'match.angle.repeatFactor': [0.85, 0, 1],
      'match.angle.cardRepeatFactor': [0.93, 0, 1],
      'match.angle.crowdBlend': [0.35, 0, 1],
      'match.angle.writingFloorPerLevel': [3, 0, 10],
      'match.angle.writingCeilingAtZero': [75, 0, 100],
      'match.angle.writingCeilingPerLevel': [2.5, 0, 10],
    });
    const categories = Object.entries(ALL_TUNABLES)
      .filter(([key]) => key in angleTunables)
      .map(([, def]) => def.category);
    expect(categories).toEqual(Array.from({ length: 17 }, () => 'Angles'));
  });
});

describe('pickBeatStat', () => {
  it('takes the highest value', () => {
    expect(
      pickBeatStat([
        { stat: 'mic', own: 60, managerValue: 69.7 },
        { stat: 'charisma', own: 64, managerValue: null },
      ]),
    ).toEqual({ stat: 'mic', value: 69.7, viaManager: true });
  });

  it('gives a tie to the earlier stat, then to own over manager', () => {
    expect(
      pickBeatStat([
        { stat: 'charisma', own: 50, managerValue: 50 },
        { stat: 'mic', own: 50, managerValue: null },
      ]),
    ).toEqual({ stat: 'charisma', value: 50, viaManager: false });
  });

  it('refuses an empty list', () => {
    expect(() => pickBeatStat([])).toThrow(/at least one stat/);
  });
});

describe('beatWorkerValue', () => {
  it('scores 0 when every input is 0', () => {
    const result = value(inputs({ values: { mic: 0, charisma: 0, presence: 0 } }));
    expect(result.value).toBe(0);
    expect(result.trace.label).toBe('Ava Stone');
    expect(result.trace.docRef).toBe('angle-rating.md#beat-worker-value');
  });

  it('caps at 100 with every input at its max', () => {
    const result = value(
      inputs({ values: { mic: 100, charisma: 100, presence: 100 }, morale: 100, momentum: 100 }),
    );
    // 100 x 1 morale x 1.05 momentum = 105, kept at 100.
    const clamp = expectTraceContains(result, { kind: 'clamp' });
    expect(clamp.before).toBeCloseTo(105);
    expect(clamp.applied).toBe(true);
    expect(result.value).toBe(100);
  });

  it('picks the best stat and names the ones it beat', () => {
    const result = value(inputs());
    expect(result.value).toBe(78);
    const decision = bestStat(result);
    expect(decision.chosen).toBe('mic');
    expect(decision.reason).toBe('Best stat: Mic 78 (Charisma 64, Presence 51)');
    expect(decision.considered.map((option) => option.option)).toEqual([
      'mic',
      'charisma',
      'presence',
    ]);
  });

  it.each([
    [-100, 78 * 0.85],
    [-1, 78 * (1 - 0.15 / 100)],
    [0, 78],
    [1, 78],
  ])('morale %i scales every stat to %f', (morale, expected) => {
    const result = value(inputs({ morale }));
    expect(result.value).toBeCloseTo(expected, 9);
  });

  it.each([
    [null, 78],
    [-100, 78 * 0.9],
    [0, 78],
    [100, 78 * 1.05],
  ])('momentum %s scales every stat', (momentum, expected) => {
    const result = value(inputs({ momentum }));
    expect(result.value).toBeCloseTo(expected, 9);
  });

  it('notes when there is no momentum yet', () => {
    expectTraceContains(value(inputs({ momentum: null })), {
      kind: 'note',
      label: NO_MOMENTUM_NOTE,
    });
    const withMomentum = findTraceNodes(value(inputs({ momentum: 0 })).trace, 'note');
    expect(withMomentum.some((node) => node.label === NO_MOMENTUM_NOTE)).toBe(false);
  });

  it("lets a manager's 82 mic at 85% beat an own 60 mic", () => {
    const result = value(inputs({ values: { mic: 60, charisma: 50, presence: 40 }, manager: REX }));
    expect(result.value).toBeCloseTo(82 * 0.85, 9);
    const decision = bestStat(result);
    expect(decision.chosen).toBe('mic:manager');
    const manager = decision.considered.find((option) => option.option === 'mic:manager');
    expect(manager?.reason).toBe('Manager Rex Halden stands in on Mic: 82 × 85% = 69.7');
    expect(decision.reason).toBe(
      'Best stat: Mic via manager Rex Halden 69.7 (Mic 60, Charisma 50, Charisma via manager 34, Presence 40)',
    );
    expectTraceContains(result, {
      kind: 'note',
      label: 'Manager Rex Halden stands in on Mic',
    });
  });

  it('keeps the own value when it beats the manager', () => {
    const result = value(inputs({ manager: REX }));
    expect(result.value).toBe(78);
    expect(bestStat(result).chosen).toBe('mic');
  });

  it('never lets the manager in when the group does not allow it', () => {
    const result = value(
      inputs({
        values: { mic: 60, charisma: 50, presence: 40 },
        manager: REX,
        managerCanStandIn: false,
      }),
    );
    expect(result.value).toBe(60);
    expect(
      bestStat(result).considered.every((option) => !String(option.option).endsWith(':manager')),
    ).toBe(true);
  });

  it('never lets the manager stand in on a stat that is not talking', () => {
    const result = value(
      inputs({
        stats: ['presence', 'athleticism'],
        values: { presence: 30, athleticism: 20 },
        manager: { name: 'Rex Halden', values: { presence: 90, athleticism: 90 }, morale: 0 },
      }),
    );
    expect(result.value).toBe(30);
    expect(bestStat(result).considered.map((option) => option.option)).toEqual([
      'presence',
      'athleticism',
    ]);
  });

  it('lets low morale flip the pick from own mic to the manager', () => {
    const base = inputs({ stats: ['mic'], values: { mic: 75 }, manager: REX });
    // 75 > 82 x 0.85 = 69.7 at neutral morale ...
    expect(bestStat(value(base)).chosen).toBe('mic');
    // ... but 75 x 0.85 = 63.75 < 69.7 at morale -100.
    const low = value({ ...base, morale: -100 });
    expect(bestStat(low).chosen).toBe('mic:manager');
    expect(low.value).toBeCloseTo(82 * 0.85, 9);
  });

  it("applies the manager's own morale to their share", () => {
    const result = value(
      inputs({ values: { mic: 10 }, stats: ['mic'], manager: { ...REX, morale: -100 } }),
    );
    expect(result.value).toBeCloseTo(82 * 0.85 * 0.85, 9);
    expectTraceContains(result, { kind: 'formula', label: 'Morale of Rex Halden' });
  });

  it.each([
    [0, 60, 'mic'],
    [1, 82, 'mic:manager'],
  ])('managerShare %f gives %f via %s', (share, expected, chosen) => {
    const result = value(
      inputs({ values: { mic: 60, charisma: 50, presence: 40 }, manager: REX }),
      {
        ...QUIET,
        'match.angle.managerShare': share,
      },
    );
    expect(result.value).toBeCloseTo(expected, 9);
    expect(bestStat(result).chosen).toBe(chosen);
  });

  it('scales popularity by its share, down to nothing at 0', () => {
    const popular = inputs({
      stats: ['popularity', 'presence'],
      values: { popularity: 90, presence: 50 },
    });
    const result = value(popular);
    expect(result.value).toBeCloseTo(81, 9);
    expectTraceContains(result, { kind: 'multiply', label: 'Popularity counts for' });
    const off = value(popular, { ...QUIET, 'match.angle.popularityStatShare': 0 });
    expect(off.value).toBe(50);
    expect(bestStat(off).chosen).toBe('presence');
  });

  it('counts a missing stat as 0', () => {
    const result = value(inputs({ stats: ['broadcasting'], values: {} }));
    expect(result.value).toBe(0);
  });

  it('draws no roll when statNoise is 0', () => {
    const result = value(inputs());
    expect(findTraceNodes(result.trace, 'roll')).toHaveLength(0);
    expectTraceContains(result, { kind: 'branch', label: NO_NOISE_BRANCH });
  });

  it.each([3, 10])('rolls up to %i points either way on match.angle', (spread) => {
    const result = value(
      inputs(),
      { 'match.angle.statNoise': spread },
      stream(`noise-${String(spread)}`),
    );
    const roll = expectRollRecorded(result, 'match.angle');
    expect(roll.label).toBe(STAT_NOISE_LABEL);
    expect(roll.min).toBe(-spread);
    expect(roll.max).toBe(spread);
    expect(result.value).toBe(78 + Number(roll.result));
  });

  it("treats a rival worker's morale and momentum as neutral", () => {
    const result = value(
      inputs({
        morale: -100,
        momentum: -100,
        isViewersWorker: false,
        manager: { ...REX, morale: -100 },
      }),
    );
    expect(result.value).toBe(78);
    expectTraceContains(result, { kind: 'note', label: NOT_YOUR_WORKER_NOTE });
    // The factors are plain neutral constants: no node carries the rival's real morale or momentum.
    const factors = findTraceNodes(result.trace, 'constant').filter((node) =>
      ['Morale factor', 'Momentum factor'].includes(node.label),
    );
    expect(factors.map((node) => [node.value, node.reason])).toEqual([
      [1, 'Not your worker: treated as neutral'],
      [1, 'Not your worker: treated as neutral'],
    ]);
    expect(findTraceNodes(result.trace, 'input').some((node) => node.label === 'Morale')).toBe(
      false,
    );
    expect(JSON.stringify(result.trace)).not.toMatch(/"value":-100/);
  });

  it('refuses an empty stat mix', () => {
    expect(() => value(inputs({ stats: [] }))).toThrow(/at least one stat/);
  });
});
