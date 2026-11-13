// Recent form multiplier. Design: docs/design/box-office.md#recent-form
import { describe, expect, it } from 'vitest';
import { findTraceNodes, type Traced } from '../../../../src/core/trace';
import {
  computeRecentFormMultiplier,
  type RecentFormMultiplierInputs,
} from '../../../../src/systems/boxOffice';
import { createEngineTunables, type EngineTunables } from '../../../../src/systems/tunables';
import { expectSerialisable, expectTraceReplays } from '../../../support/trace';

const DEFAULTS = createEngineTunables();

function form(
  inputs: RecentFormMultiplierInputs,
  tunables: EngineTunables = DEFAULTS,
): Traced<number> {
  const result = computeRecentFormMultiplier(inputs, { tunables });
  expectTraceReplays(result);
  expectSerialisable(result);
  return result;
}

function notes(result: Traced<number>): string[] {
  return findTraceNodes(result.trace, 'note').map((node) => node.label);
}

describe('computeRecentFormMultiplier', () => {
  it('is 1 with fewer than the minimum shows, and says so', () => {
    const result = form({ averageScore: 90, showCount: 2 });
    expect(result.value).toBe(1);
    const [branch] = findTraceNodes(result.trace, 'branch');
    expect(branch?.label).toBe('Fewer than 3 recent shows');
    expect(branch?.value).toBe(true);
    expect(notes(result)).toEqual(['Not enough recent shows (2 of 3)']);
  });

  it('is 1 with no shows at all', () => {
    expect(form({ averageScore: null, showCount: 0 }).value).toBe(1);
  });

  it('swings at exactly the minimum shows', () => {
    const result = form({ averageScore: 75, showCount: 3 });
    expect(result.value).toBeCloseTo(1.15, 12);
    expect(findTraceNodes(result.trace, 'branch')[0]?.value).toBe(false);
  });

  it('is 1 at par', () => {
    expect(form({ averageScore: 50, showCount: 5 }).value).toBe(1);
  });

  it('reaches the full swing at par ± fullSwingPoints and no further', () => {
    expect(form({ averageScore: 75, showCount: 5 }).value).toBeCloseTo(1.15, 12);
    expect(form({ averageScore: 100, showCount: 5 }).value).toBeCloseTo(1.15, 12);
    expect(form({ averageScore: 25, showCount: 5 }).value).toBeCloseTo(0.85, 12);
    expect(form({ averageScore: 0, showCount: 5 }).value).toBeCloseTo(0.85, 12);
  });

  it('records the clamp only when it bites', () => {
    const inside = form({ averageScore: 74, showCount: 5 });
    expect(findTraceNodes(inside.trace, 'clamp')[0]?.applied).toBe(false);
    const outside = form({ averageScore: 76, showCount: 5 });
    expect(findTraceNodes(outside.trace, 'clamp')[0]?.applied).toBe(true);
  });

  it('scales linearly inside the swing', () => {
    expect(form({ averageScore: 60, showCount: 5 }).value).toBeCloseTo(1.06, 12);
    expect(form({ averageScore: 40, showCount: 5 }).value).toBeCloseTo(0.94, 12);
  });

  it('is always 1 with maxSwing 0', () => {
    const off = createEngineTunables({ 'boxOffice.recentForm.maxSwing': 0 });
    expect(form({ averageScore: 100, showCount: 10 }, off).value).toBe(1);
  });

  it('swings by up to half at maxSwing 0.5', () => {
    const max = createEngineTunables({ 'boxOffice.recentForm.maxSwing': 0.5 });
    expect(form({ averageScore: 0, showCount: 10 }, max).value).toBeCloseTo(0.5, 12);
  });

  it('counts a single show when minShows is 0', () => {
    const any = createEngineTunables({ 'boxOffice.recentForm.minShows': 0 });
    expect(form({ averageScore: 75, showCount: 1 }, any).value).toBeCloseTo(1.15, 12);
    expect(form({ averageScore: null, showCount: 0 }, any).value).toBe(1);
  });

  it('moves the par and the full swing with their tunables', () => {
    const tunables = createEngineTunables({
      'boxOffice.recentForm.par': 0,
      'boxOffice.recentForm.fullSwingPoints': 100,
    });
    expect(form({ averageScore: 50, showCount: 3 }, tunables).value).toBeCloseTo(1.075, 12);
  });
});
