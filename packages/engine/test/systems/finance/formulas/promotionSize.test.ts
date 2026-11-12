// Promotion size. Design: docs/design/finances.md#reach-and-size
import { describe, expect, it } from 'vitest';
import { findTraceNodes, inputOf } from '../../../../src/core/trace';
import type { TunableOverrides } from '../../../../src/core/tunables';
import {
  PROMOTION_SIZE_LABELS,
  PROMOTION_SIZES,
  promotionSize,
  THRESHOLDS_OUT_OF_ORDER_NOTE,
  type PromotionSize,
} from '../../../../src/systems/finance';
import { createEngineTunables } from '../../../../src/systems/tunables';
import { expectSerialisable, expectTraceContains } from '../../../support/trace';

function sizeOf(reach: number, overrides: TunableOverrides = {}) {
  const result = promotionSize(inputOf('Reach', reach, undefined, 'points'), {
    tunables: createEngineTunables(overrides),
  });
  expectSerialisable(result);
  return result;
}

describe('promotionSize', () => {
  it('has a label for every size, smallest first', () => {
    expect(PROMOTION_SIZES).toEqual(['local', 'regional', 'national', 'continental', 'global']);
    expect(PROMOTION_SIZES.map((size) => PROMOTION_SIZE_LABELS[size])).toEqual([
      'Local',
      'Regional',
      'National',
      'Continental',
      'Global',
    ]);
  });

  const boundaries: readonly [number, PromotionSize, PromotionSize][] = [
    [6, 'regional', 'local'],
    [25, 'national', 'regional'],
    [45, 'continental', 'national'],
    [70, 'global', 'continental'],
  ];
  for (const [at, size, below] of boundaries) {
    it(`is ${size} exactly at ${String(at)} and ${below} just below it`, () => {
      expect(sizeOf(at).value).toBe(size);
      expect(sizeOf(at - 0.001).value).toBe(below);
    });
  }

  it('is local at 0 and global at 100', () => {
    expect(sizeOf(0).value).toBe('local');
    expect(sizeOf(100).value).toBe('global');
  });

  it('records the rules from Global down to the one that passed, and the reason', () => {
    const result = sizeOf(30);
    const rules = findTraceNodes(result.trace, 'branch').map((node) => [node.label, node.value]);
    expect(rules).toEqual([
      ['Reach ≥ Global threshold (70)', false],
      ['Reach ≥ Continental threshold (45)', false],
      ['Reach ≥ National threshold (25)', true],
    ]);
    const decision = findTraceNodes(result.trace, 'decision')[0];
    expect(decision?.reason).toBe(
      'Reach 30.0 reached the National threshold (25) but not the Continental threshold (45)',
    );
    expect(findTraceNodes(result.trace, 'tunable').map((node) => node.key)).toEqual([
      'finance.size.regionalAt',
      'finance.size.nationalAt',
      'finance.size.continentalAt',
      'finance.size.globalAt',
    ]);
  });

  it('says when reach is below every threshold', () => {
    const decision = findTraceNodes(sizeOf(2).trace, 'decision')[0];
    expect(decision?.reason).toBe('Reach 2.0 is below the Regional threshold (6)');
  });

  it('follows tuned thresholds, 0 included', () => {
    expect(sizeOf(0, { 'finance.size.regionalAt': 0 }).value).toBe('regional');
    expect(sizeOf(30, { 'finance.size.globalAt': 30 }).value).toBe('global');
  });

  it('still walks from the largest size down when the thresholds are out of order', () => {
    const overrides = { 'finance.size.nationalAt': 80, 'finance.size.globalAt': 50 };
    const result = sizeOf(60, overrides);
    expect(result.value).toBe('global');
    expectTraceContains(result, { kind: 'note', label: THRESHOLDS_OUT_OF_ORDER_NOTE });
    expect(sizeOf(48, overrides).value).toBe('continental');
    const inOrder = sizeOf(60);
    expect(findTraceNodes(inOrder.trace, 'note').map((node) => node.label)).not.toContain(
      THRESHOLDS_OUT_OF_ORDER_NOTE,
    );
  });
});
