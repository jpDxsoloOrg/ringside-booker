// Hot streak (EVT6-11). Design: docs/design/box-office.md#hot-streak
import { describe, expect, it } from 'vitest';
import { findTraceNodes } from '../../../../src/core/trace';
import { computeHotStreak, hotStreakState } from '../../../../src/systems/boxOffice';
import { createEngineTunables, type EngineTunables } from '../../../../src/systems/tunables';
import { expectSerialisable, expectTraceReplays } from '../../../support/trace';

const DEFAULTS = createEngineTunables();

function streak(scores: readonly number[], tunables: EngineTunables = DEFAULTS): number {
  const result = computeHotStreak({ scores }, { tunables });
  expectTraceReplays(result);
  expectSerialisable(result);
  return result.value;
}

describe('computeHotStreak', () => {
  it('is 1 with no recent shows, and says how a streak starts', () => {
    const result = computeHotStreak({ scores: [] }, { tunables: DEFAULTS });
    expect(result.value).toBe(1);
    expect(findTraceNodes(result.trace, 'note').map((node) => node.label)).toContain('No hot streak: a show scoring 60 or better starts one');
    expect(result.trace.docRef).toBe('box-office.md#hot-streak');
  });

  it('adds 2.5% for each good show in a row, from a score of 60', () => {
    expect(streak([60])).toBeCloseTo(1.025, 12);
    expect(streak([59.9])).toBe(1);
    expect(streak([70, 65, 80])).toBeCloseTo(1.075, 12);
  });

  it('stops at the cap of 12.5%', () => {
    expect(streak([70, 70, 70, 70, 70])).toBeCloseTo(1.125, 12);
    expect(streak(Array.from({ length: 12 }, () => 90))).toBeCloseTo(1.125, 12);
  });

  it('breaks on a poor show and fades 5% a show instead of vanishing', () => {
    const run = [70, 70, 70, 70, 70];
    expect(streak([...run, 40])).toBeCloseTo(1.075, 12);
    expect(streak([...run, 40, 50])).toBeCloseTo(1.025, 12);
    expect(streak([...run, 40, 50, 30])).toBe(1);
    const state = hotStreakState([...run, 40, 50], DEFAULTS);
    expect(state).toMatchObject({ run: 0, sinceBreak: 2 });
    expect(state.startBonus).toBeCloseTo(0.125, 12);
  });

  it('builds a new streak on what is left of the last one', () => {
    // 3 good (7.5%), 1 poor (2.5% left), 2 good: 2.5% + 2 × 2.5%.
    const result = computeHotStreak({ scores: [70, 70, 70, 40, 70, 70] }, { tunables: DEFAULTS });
    expect(result.value).toBeCloseTo(1.075, 12);
    const labels = JSON.stringify(result.trace);
    expect(labels).toContain('2 good shows in a row (60 or better)');
    expect(labels).toContain('Left from an earlier streak');
  });

  it('is off with perShow 0 and follows the good score', () => {
    const off = createEngineTunables({ 'boxOffice.streak.perShow': 0 });
    expect(streak([90, 90, 90], off)).toBe(1);
    const strict = createEngineTunables({ 'boxOffice.streak.goodScore': 80 });
    expect(streak([70, 70], strict)).toBe(1);
    expect(streak([85, 85], strict)).toBeCloseTo(1.05, 12);
  });
});
