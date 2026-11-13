// The Office's KPI formulas (DAY2-03): kpiDelta, rosterSize, averageMorale.
// Design: docs/design/office.md#kpis-and-deltas
import { describe, expect, it } from 'vitest';
import { parseGameDate } from '../../../../src/core/date';
import { findTraceNodes, inputOf } from '../../../../src/core/trace';
import type { TunableOverrides } from '../../../../src/core/tunables';
import {
  averageMorale,
  kpiDelta,
  rosterSize,
  type KpiDeltaInputs,
  type MoraleContract,
} from '../../../../src/systems/office';
import { createEngineTunables } from '../../../../src/systems/tunables';
import { expectSerialisable, expectTraceReplays } from '../../../support/trace';

const TODAY = parseGameDate('2026-01-19');
const LAST_MONDAY = parseGameDate('2026-01-12');

function delta(inputs: Partial<KpiDeltaInputs> = {}, overrides: TunableOverrides = {}) {
  const result = kpiDelta(
    {
      label: 'Popularity',
      unit: 'points',
      current: 69,
      previous: { value: 68.2, date: LAST_MONDAY, granularity: 'week' },
      today: TODAY,
      ...inputs,
    },
    { tunables: createEngineTunables(overrides) },
  );
  expectTraceReplays(result);
  expectSerialisable(result);
  return result;
}

function notesOf(trace: Parameters<typeof findTraceNodes>[0]): string[] {
  return findTraceNodes(trace, 'note').map((node) => node.label);
}

describe('kpiDelta', () => {
  it('is this week minus last week, unrounded, with both dates in the Why?', () => {
    const result = delta();
    expect(result.value).toBeCloseTo(0.8, 12);
    expect(result.trace.label).toBe('Change in Popularity since Mon 12 Jan');
    const inputs = findTraceNodes(result.trace, 'input').map((node) => node.label);
    expect(inputs).toContain('This week (Mon 19 Jan)');
    expect(findTraceNodes(result.trace, 'subtract')[0]?.label).toBe('Last week (Mon 12 Jan)');
    expect(notesOf(result.trace)).toEqual([]);
  });

  it('gives 0 for no change and a negative number for a fall', () => {
    expect(delta({ current: 68.2 }).value).toBe(0);
    expect(delta({ current: 60 }).value).toBeCloseTo(-8.2, 12);
  });

  it('nests a traced current value', () => {
    const result = delta({ current: inputOf('Roster size', 12, undefined, 'count') });
    expect(result.value).toBeCloseTo(12 - 68.2, 12);
    expect(findTraceNodes(result.trace, 'input').map((node) => node.label)).toContain(
      'Roster size',
    );
  });

  it('notes a comparison older than the lookback plus six days', () => {
    const old = parseGameDate('2025-12-29');
    const result = delta({ previous: { value: 50, date: old, granularity: 'week' } });
    expect(notesOf(result.trace)).toEqual([
      'The last record before that is from Mon 29 Dec 2025, 21 days ago',
    ]);
    expect(findTraceNodes(result.trace, 'subtract')[0]?.label).toBe(
      'Last record (Mon 29 Dec 2025)',
    );
    // Thirteen days back is still within 7 + 6.
    const recent = delta({
      previous: { value: 50, date: parseGameDate('2026-01-06'), granularity: 'week' },
    });
    expect(notesOf(recent.trace)).toEqual([]);
  });

  it('notes a monthly row even when it is recent enough', () => {
    const result = delta({ previous: { value: 50, date: LAST_MONDAY, granularity: 'month' } });
    expect(notesOf(result.trace)).toEqual([
      'Older weeks are kept as one record a month, so this compares with a monthly record',
    ]);
  });

  it('reads the lookback tunable for the stale rule', () => {
    const result = delta(
      { previous: { value: 50, date: parseGameDate('2025-12-29'), granularity: 'week' } },
      { 'office.delta.lookbackDays': 30 },
    );
    expect(notesOf(result.trace)).toEqual([]);
  });
});

describe('rosterSize', () => {
  const NONE = {
    wrestler: 0,
    manager: 0,
    presenter: 0,
    announcer: 0,
    referee: 0,
    producer: 0,
    booker: 0,
  };

  it('is 0 with no role lines when nobody is under contract', () => {
    const result = rosterSize({ byRole: NONE });
    expectTraceReplays(result);
    expectSerialisable(result);
    expect(result.value).toBe(0);
    expect(findTraceNodes(result.trace, 'add')).toEqual([]);
  });

  it('adds one line per role with anyone in it', () => {
    const result = rosterSize({ byRole: { ...NONE, wrestler: 44, referee: 3, producer: 8 } });
    expectTraceReplays(result);
    expectSerialisable(result);
    expect(result.value).toBe(55);
    expect(findTraceNodes(result.trace, 'add').map((node) => [node.label, node.operand])).toEqual([
      ['Wrestlers', 44],
      ['Referees', 3],
      ['Producers', 8],
    ]);
  });
});

describe('averageMorale', () => {
  function average(contracts: readonly MoraleContract[], overrides: TunableOverrides = {}) {
    const result = averageMorale({ contracts }, { tunables: createEngineTunables(overrides) });
    expectTraceReplays(result);
    expectSerialisable(result);
    return result;
  }

  const MIXED: readonly MoraleContract[] = [
    { name: 'Ace', role: 'wrestler', morale: 20 },
    { name: 'Blaze', role: 'wrestler', morale: -6 },
    { name: 'Cobra', role: 'wrestler', morale: 10 },
    { name: 'Dee', role: 'referee', morale: 4 },
    { name: 'Eve', role: 'producer', morale: -10 },
  ];

  it('is 0 with a note when nobody is under contract', () => {
    const result = average([]);
    expect(result.value).toBe(0);
    expect(notesOf(result.trace)).toEqual(['Nobody is under contract']);
  });

  it('is the one morale for one contract', () => {
    const result = average([{ name: 'Ace', role: 'wrestler', morale: 12 }]);
    expect(result.value).toBe(12);
    expect(findTraceNodes(result.trace, 'add')[0]?.label).toBe(
      'Wrestlers: 1 contract, average 12.0',
    );
  });

  it('weights each role group by its count and names the lowest three', () => {
    const result = average(MIXED);
    expect(result.value).toBeCloseTo(18 / 5, 12);
    expect(findTraceNodes(result.trace, 'add').map((node) => node.label)).toEqual([
      'Wrestlers: 3 contracts, average 8.0',
      'Referees: 1 contract, average 4.0',
      'Producers: 1 contract, average -10.0',
    ]);
    expect(notesOf(result.trace)).toEqual([
      'Low morale: Eve -10.0',
      'Low morale: Blaze -6.0',
      'Low morale: Dee 4.0',
    ]);
    expect(findTraceNodes(result.trace, 'tunable').map((node) => node.key)).toEqual([
      'office.morale.namedInWhy',
    ]);
  });

  it('names nobody at 0 and everyone at 10', () => {
    expect(notesOf(average(MIXED, { 'office.morale.namedInWhy': 0 }).trace)).toEqual([]);
    expect(notesOf(average(MIXED, { 'office.morale.namedInWhy': 10 }).trace)).toHaveLength(5);
  });
});
