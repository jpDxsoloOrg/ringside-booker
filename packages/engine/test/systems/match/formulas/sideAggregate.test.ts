// Side aggregation. Design: docs/design/match-rating.md#sides
import { describe, expect, it } from 'vitest';
import { findTraceNodes, untraced } from '../../../../src/core/trace';
import type { TunableOverrides } from '../../../../src/core/tunables/overrides';
import {
  aggregateWeights,
  rankLabel,
  sideAggregate,
  type SideAggregateMember,
  type SideDecayKey,
} from '../../../../src/systems/match';
import { createEngineTunables } from '../../../../src/systems/tunables';
import {
  expectSerialisable,
  expectTraceContains,
  expectTraceReplays,
} from '../../../support/trace';

function member(id: string, name: string, value: number): SideAggregateMember {
  return { id, name, value: untraced(value, `${name}'s performance`) };
}

function aggregate(
  members: readonly SideAggregateMember[],
  overrides: TunableOverrides = {},
  decayKey: SideDecayKey = 'match.side.depthDecay',
) {
  const result = sideAggregate(
    { label: 'Side 1', members, decayKey },
    { tunables: createEngineTunables(overrides) },
  );
  expectTraceReplays(result);
  expectSerialisable(result.trace);
  return result;
}

function addLabels(result: ReturnType<typeof aggregate>): string[] {
  return findTraceNodes(result.trace, 'add')
    .filter((node) => node.label.includes(' × '))
    .map((node) => node.label);
}

describe('aggregateWeights', () => {
  it.each([0, 0.55, 1])('sums to 1 for n = 1..30 at decay %s', (decay) => {
    for (let count = 1; count <= 30; count += 1) {
      const weights = aggregateWeights(count, decay);
      expect(weights).toHaveLength(count);
      expect(Math.abs(weights.reduce((sum, weight) => sum + weight, 0) - 1)).toBeLessThanOrEqual(
        1e-9,
      );
      expect(weights.every((weight) => Number.isFinite(weight) && weight >= 0)).toBe(true);
    }
  });

  it('gives all the weight to the best member at decay 0', () => {
    expect(aggregateWeights(4, 0)).toEqual([1, 0, 0, 0]);
  });

  it('gives equal weights at decay 1', () => {
    expect(aggregateWeights(4, 1)).toEqual([0.25, 0.25, 0.25, 0.25]);
  });

  it('falls by the decay from one rank to the next', () => {
    const [first = 0, second = 0] = aggregateWeights(2, 0.55);
    expect(first).toBeCloseTo(1 / 1.55, 12);
    expect(second / first).toBeCloseTo(0.55, 12);
  });

  it.each([0, -1, 1.5, Number.NaN])('refuses count %s', (count) => {
    expect(() => aggregateWeights(count, 0.5)).toThrow(RangeError);
    expect(() => aggregateWeights(count, 0.5)).toThrow(/count must be/);
  });

  it.each([-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY])('refuses decay %s', (decay) => {
    expect(() => aggregateWeights(2, decay)).toThrow(RangeError);
    expect(() => aggregateWeights(2, decay)).toThrow(/decay must be/);
  });
});

describe('sideAggregate', () => {
  it('ranks numerically, never by string: 100 > 55.5 > 9', () => {
    const result = aggregate([
      member('a', 'Nine', 9),
      member('b', 'Hundred', 100),
      member('c', 'Half', 55.5),
    ]);
    expect(addLabels(result).map((label) => label.split(' (')[0])).toEqual([
      'Hundred',
      'Half',
      'Nine',
    ]);
    const total = 1 + 0.55 + 0.55 ** 2;
    expect(result.value).toBeCloseTo((100 + 55.5 * 0.55 + 9 * 0.55 ** 2) / total, 10);
  });

  it('breaks ties by id, ascending', () => {
    const result = aggregate([member('per_b', 'Bram', 60), member('per_a', 'Ash', 60)]);
    expect(addLabels(result)[0]).toMatch(/^Ash \(best on side\)/);
  });

  it('labels each member with its rank and weight', () => {
    const result = aggregate([member('a', 'Kade Morrow', 80), member('b', 'Rook Vance', 60)]);
    expect(addLabels(result)).toEqual([
      'Kade Morrow (best on side) × 0.65',
      'Rook Vance (2nd on side) × 0.35',
    ]);
  });

  it('names the depth decay tunable', () => {
    const result = aggregate([member('a', 'Kade Morrow', 80)]);
    expect(expectTraceContains(result, { kind: 'tunable' }).key).toBe('match.side.depthDecay');
  });

  it('counts only the best member at decay 0', () => {
    const result = aggregate(
      [member('a', 'Low', 20), member('b', 'High', 90), member('c', 'Mid', 50)],
      { 'match.side.depthDecay': 0 },
    );
    expect(result.value).toBe(90);
  });

  it('is a plain mean at decay 1', () => {
    const result = aggregate(
      [member('a', 'Low', 20), member('b', 'High', 90), member('c', 'Mid', 40)],
      { 'match.side.depthDecay': 1 },
    );
    expect(result.value).toBeCloseTo(50, 10);
  });

  it('gives one member its own value', () => {
    expect(aggregate([member('a', 'Solo', 63.25)]).value).toBe(63.25);
  });

  it('reads the decay named by the key', () => {
    const result = aggregate(
      [member('00', 'Side 1', 80), member('01', 'Side 2', 60)],
      { 'match.sides.depthDecay': 0, 'match.side.depthDecay': 1 },
      'match.sides.depthDecay',
    );
    expect(result.value).toBe(80);
    expect(addLabels(result)[0]).toBe('Side 1 (best side) × 1');
  });

  it('refuses an empty side', () => {
    expect(() =>
      sideAggregate(
        { label: 'Side 2', members: [], decayKey: 'match.side.depthDecay' },
        { tunables: createEngineTunables() },
      ),
    ).toThrow(/Side 2/);
  });

  it('writes ordinal ranks', () => {
    expect(
      [0, 1, 2, 3, 10, 11, 20].map((index) => rankLabel(index, 'match.sides.depthDecay')),
    ).toEqual([
      'best side',
      '2nd side',
      '3rd side',
      '4th side',
      '11th side',
      '12th side',
      '21st side',
    ]);
  });
});
