// Heat cooling (CRTV3-02). Design: docs/design/storylines.md#heat-decay
import { describe, expect, it } from 'vitest';
import { findTraceNodes } from '../../../../src/core/trace/helpers';
import type { Traced } from '../../../../src/core/trace/types';
import type { TunableOverrides } from '../../../../src/core/tunables/overrides';
import { heatDecay } from '../../../../src/systems/storylines';
import { createEngineTunables } from '../../../../src/systems/tunables';
import {
  expectSerialisable,
  expectTraceContains,
  expectTraceReplays,
} from '../../../support/trace';

function cool(
  heatBefore: number,
  daysSinceProgress: number,
  overrides: TunableOverrides = {},
): Traced<number> {
  const result = heatDecay(
    { heatBefore, daysSinceProgress, progressLabel: 'Started 2027-01-04' },
    { tunables: createEngineTunables(overrides) },
  );
  expectTraceReplays(result);
  expectSerialisable(result);
  return result;
}

describe('heatDecay', () => {
  it('starts from yesterday’s heat and records the days since progress', () => {
    const result = cool(40, 3);
    expect(result.trace).toMatchObject({
      kind: 'formula',
      label: 'Heat after cooling',
      unit: 'points',
      docRef: 'docs/design/storylines.md#heat-decay',
    });
    expect(expectTraceContains(result, { kind: 'input', label: 'Heat yesterday' }).value).toBe(40);
    expectTraceContains(result, {
      kind: 'note',
      label: 'Days since progress: 3 days (Started 2027-01-04)',
    });
  });

  it('keeps heat inside the grace period', () => {
    const result = cool(40, 3);
    expect(result.value).toBe(40);
    expect(
      expectTraceContains(result, { kind: 'branch', label: 'Inside the grace period of 7 days' }),
    ).toMatchObject({ taken: true });
    expect(findTraceNodes(result.trace, 'subtract')).toEqual([]);
  });

  it('keeps heat on the last grace day', () => {
    expect(cool(40, 7).value).toBe(40);
  });

  it('cools by 1 the day after the grace period', () => {
    const result = cool(40, 8);
    expect(result.value).toBe(39);
    expect(expectTraceContains(result, { kind: 'subtract', label: 'Daily cooling' })).toMatchObject(
      { operand: 1, before: 40, after: 39 },
    );
    expectTraceContains(result, { kind: 'max', label: 'Cooling floor' });
    expectTraceContains(result, { kind: 'note', label: 'Cooling for 1 day so far' });
    const keys = findTraceNodes(result.trace, 'tunable').map((node) => node.key);
    expect(keys).toEqual(
      expect.arrayContaining(['storylines.heat.decayGraceDays', 'storylines.heat.decayPerDay']),
    );
  });

  it('shows the grace period and the floor it passed as taken checks, each with its setting', () => {
    const result = cool(40, 13);
    const grace = expectTraceContains(result, {
      kind: 'branch',
      label: 'Past the grace period of 7 days',
    });
    expect(grace).toMatchObject({ taken: true });
    expect(findTraceNodes(grace, 'tunable').map((node) => node.key)).toEqual([
      'storylines.heat.decayGraceDays',
    ]);
    const floor = expectTraceContains(result, {
      kind: 'branch',
      label: 'Above the cooling floor of 10',
    });
    expect(floor).toMatchObject({ taken: true });
    expect(findTraceNodes(floor, 'tunable').map((node) => node.key)).toEqual([
      'storylines.heat.decayFloor',
    ]);
  });

  it('lands on the floor and no lower', () => {
    const result = cool(10.5, 20);
    expect(result.value).toBe(10);
    expect(expectTraceContains(result, { kind: 'max', label: 'Cooling floor' })).toMatchObject({
      applied: true,
      after: 10,
    });
    expectTraceContains(result, { kind: 'note', label: 'Cooling for 13 days so far' });
  });

  it('never raises heat that starts below the floor', () => {
    const result = cool(8, 30);
    expect(result.value).toBe(8);
    expect(
      expectTraceContains(result, {
        kind: 'branch',
        label: 'Already at or below the cooling floor',
      }),
    ).toMatchObject({ taken: true });
  });

  it('does not cool with decayPerDay 0', () => {
    expect(cool(40, 30, { 'storylines.heat.decayPerDay': 0 }).value).toBe(40);
  });

  it('cools from day 1 with grace 0', () => {
    expect(cool(40, 0, { 'storylines.heat.decayGraceDays': 0 }).value).toBe(40);
    expect(cool(40, 1, { 'storylines.heat.decayGraceDays': 0 }).value).toBe(39);
  });
});
