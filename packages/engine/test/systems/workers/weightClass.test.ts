// Weight class. Design: docs/design/workers.md#weight-class
import { describe, expect, it } from 'vitest';
import { describeTunables } from '../../../src/core/tunables/describe';
import type { TunableOverrides } from '../../../src/core/tunables/overrides';
import { WEIGHT_CLASSES, weightClass, type WeightClass } from '../../../src/systems/workers';
import { createEngineTunables } from '../../../src/systems/tunables';
import { expectSerialisable, expectTraceContains } from '../../support/trace';
import { findTraceNodes } from '../../../src/core/trace';

function classOf(weightKg: number, overrides: TunableOverrides = {}) {
  const result = weightClass({ weightKg }, { tunables: createEngineTunables(overrides) });
  expectSerialisable(result);
  return result;
}

describe('weightClass', () => {
  const boundaries: readonly (readonly [number, WeightClass])[] = [
    [40, 'lightweight'],
    [70, 'lightweight'],
    [71, 'cruiserweight'],
    [93, 'cruiserweight'],
    [94, 'lightHeavyweight'],
    [105, 'lightHeavyweight'],
    [106, 'heavyweight'],
    [130, 'heavyweight'],
    [131, 'superHeavyweight'],
    [250, 'superHeavyweight'],
  ];
  it.each(boundaries)('puts %i kg in %s', (weightKg, expected) => {
    const result = classOf(weightKg);
    expect(result.value).toBe(expected);
    const decision = expectTraceContains(result, { kind: 'decision', label: 'Weight class' });
    expect(decision.chosen).toBe(expected);
    expect(decision.docRef).toBe('workers.md#weight-class');
  });

  it('covers every class', () => {
    expect(new Set(boundaries.map(([, expected]) => expected))).toEqual(new Set(WEIGHT_CLASSES));
  });

  it('names each limit by its tunable and checks every band', () => {
    const result = classOf(95);
    const tunables = findTraceNodes(result.trace, 'tunable');
    expect(tunables.map((node) => [node.key, node.label, node.value, node.unit])).toEqual([
      ['workers.weightClass.lightweightMaxKg', 'Lightweight limit', 70, 'kilograms'],
      ['workers.weightClass.cruiserweightMaxKg', 'Cruiserweight limit', 93, 'kilograms'],
      ['workers.weightClass.lightHeavyweightMaxKg', 'Light heavyweight limit', 105, 'kilograms'],
      ['workers.weightClass.heavyweightMaxKg', 'Heavyweight limit', 130, 'kilograms'],
    ]);
    const rules = findTraceNodes(result.trace, 'branch');
    expect(rules.map((node) => [node.label, node.taken])).toEqual([
      ['95 kg is over the Lightweight limit of 70 kg', true],
      ['95 kg is over the Cruiserweight limit of 93 kg', true],
      ['95 kg is over the Light heavyweight limit of 105 kg', false],
      ['95 kg is over the Heavyweight limit of 130 kg', false],
    ]);
    const decision = expectTraceContains(result, { kind: 'decision' });
    expect(decision.reason).toBe('95 kg is within the Light heavyweight limit of 105 kg');
  });

  it('explains a super heavyweight by the heavyweight limit', () => {
    const decision = expectTraceContains(classOf(140), { kind: 'decision' });
    expect(decision.reason).toBe('140 kg is over the Heavyweight limit of 130 kg');
  });

  it('moves a person when a limit is overridden', () => {
    expect(classOf(95).value).toBe('lightHeavyweight');
    const moved = classOf(95, { 'workers.weightClass.cruiserweightMaxKg': 95 });
    expect(moved.value).toBe('cruiserweight');
    const limit = expectTraceContains(moved, { kind: 'tunable', label: 'Cruiserweight limit' });
    expect(limit.value).toBe(95);
    expect(limit.defaultValue).toBe(93);
    expect(limit.overridden).toBe(true);
    expect(classOf(96, { 'workers.weightClass.cruiserweightMaxKg': 95 }).value).toBe(
      'lightHeavyweight',
    );
  });

  describe('limits set out of order', () => {
    // Cruiserweight below lightweight: the cruiserweight band is empty and reads as 70 kg.
    const overrides: TunableOverrides = { 'workers.weightClass.cruiserweightMaxKg': 60 };

    it('reads a limit below the one before it as the one before it, with a note', () => {
      const result = classOf(65, overrides);
      expect(result.value).toBe('lightweight');
      expectTraceContains(classOf(80, overrides), {
        kind: 'note',
        label:
          'The Cruiserweight limit of 60 kg is below the Lightweight limit of 70 kg, so 70 kg is used',
      });
      expectTraceContains(classOf(80, overrides), {
        kind: 'branch',
        label: '80 kg is over the Cruiserweight limit of 70 kg',
      });
    });

    it('never throws and leaves no gap between classes', () => {
      expect(classOf(70, overrides).value).toBe('lightweight');
      expect(classOf(71, overrides).value).toBe('lightHeavyweight');
      expect(classOf(105, overrides).value).toBe('lightHeavyweight');
    });

    it('carries the raised limit forward through several bands', () => {
      const allLow: TunableOverrides = {
        'workers.weightClass.lightweightMaxKg': 120,
        'workers.weightClass.cruiserweightMaxKg': 50,
        'workers.weightClass.lightHeavyweightMaxKg': 60,
      };
      expect(classOf(120, allLow).value).toBe('lightweight');
      expect(classOf(121, allLow).value).toBe('heavyweight');
      expect(findTraceNodes(classOf(121, allLow).trace, 'note')).toHaveLength(2);
      expect(classOf(131, allLow).value).toBe('superHeavyweight');
    });
  });

  it('adds no notes when the limits are in order', () => {
    expect(findTraceNodes(classOf(95).trace, 'note')).toEqual([]);
  });
});

describe('the weight class tunables', () => {
  it('are listed with descriptions, the Workers category and the kilograms unit', () => {
    const rows = describeTunables(createEngineTunables(), { keyPrefix: 'workers.weightClass.' });
    expect(rows.map((row) => [row.key, row.default, row.min, row.max])).toEqual([
      ['workers.weightClass.cruiserweightMaxKg', 93, 40, 250],
      ['workers.weightClass.heavyweightMaxKg', 130, 40, 250],
      ['workers.weightClass.lightHeavyweightMaxKg', 105, 40, 250],
      ['workers.weightClass.lightweightMaxKg', 70, 40, 250],
    ]);
    for (const row of rows) {
      expect(row.kind).toBe('integer');
      expect(row.unit).toBe('kilograms');
      expect(row.category).toBe('Workers');
      expect(row.description).not.toBe('');
      expect(row.docRef).toBe('workers.md#weight-class');
    }
  });
});
