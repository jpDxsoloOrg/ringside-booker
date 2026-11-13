// Expected attendance. Design: docs/design/box-office.md#forecast
import { describe, expect, it } from 'vitest';
import { constantOf, findTraceNodes, type Traced } from '../../../../src/core/trace';
import { EVENT_IMPORTANCES } from '../../../../src/model/entities/event-definition';
import {
  computeExpectedAttendance,
  type ExpectedAttendanceInputs,
} from '../../../../src/systems/boxOffice';
import { createEngineTunables, type EngineTunables } from '../../../../src/systems/tunables';
import { expectSerialisable, expectTraceReplays } from '../../../support/trace';

const DEFAULTS = createEngineTunables();

function one(label: string): Traced<number> {
  return constantOf(label, 1, 'Test: no effect');
}

function attendance(
  overrides: Partial<ExpectedAttendanceInputs> = {},
  tunables: EngineTunables = DEFAULTS,
): Traced<number> {
  const result = computeExpectedAttendance(
    {
      popularity: 75,
      regionName: 'Northeast',
      marketingLevel: 0,
      importance: 'regular',
      recentForm: one('Recent form'),
      bigShowFatigue: one('Big-show fatigue'),
      hype: one('Hype'),
      ...overrides,
    },
    { tunables },
  );
  expectTraceReplays(result);
  expectSerialisable(result);
  return result;
}

function topLabels(result: Traced<number>): string[] {
  return (result.trace.children ?? []).map((node) => node.label);
}

describe('computeExpectedAttendance', () => {
  it('draws only the walk-up crowd at popularity 0', () => {
    expect(attendance({ popularity: 0 }).value).toBe(80);
  });

  it('draws the walk-up crowd plus the full-popularity crowd at popularity 100', () => {
    expect(attendance({ popularity: 100 }).value).toBe(30_080);
  });

  it('grows along the popularity curve: 80 + 30,000 × 0.75³ at popularity 75', () => {
    expect(attendance().value).toBe(Math.round(80 + 30_000 * 0.75 ** 3));
  });

  it('adds 4% per marketing level', () => {
    const base = 80 + 30_000 * 0.75 ** 3;
    expect(attendance({ marketingLevel: 8 }).value).toBe(Math.round(base * 1.32));
    expect(attendance({ marketingLevel: 10 }).value).toBe(Math.round(base * 1.4));
  });

  it('scales by the show size', () => {
    const base = 80 + 30_000 * 0.75 ** 3;
    expect(attendance({ importance: 'flagship' }).value).toBe(Math.round(base * 2.2));
    expect(attendance({ importance: 'house' }).value).toBe(Math.round(base * 0.35));
  });

  it('applies recent form, fatigue and hype once each', () => {
    const result = attendance({
      recentForm: constantOf('Recent form', 1.1, 'Test'),
      bigShowFatigue: constantOf('Big-show fatigue', 0.8, 'Test'),
      hype: constantOf('Hype', 1.5, 'Test'),
    });
    const base = 80 + 30_000 * 0.75 ** 3;
    expect(result.value).toBe(Math.round(base * 1.1 * 0.8 * 1.5));
  });

  it('gives popularity, marketing, size, recent form, fatigue and hype a line each, once', () => {
    const result = attendance({ marketingLevel: 8 });
    const labels = topLabels(result);
    for (const label of [
      'Popularity in Northeast: 75',
      'Popularity curve',
      'Walk-up crowd',
      'Marketing level 8',
      'Regular show',
      'Recent form',
      'Big-show fatigue',
      'Hype',
    ]) {
      expect(labels.filter((candidate) => candidate === label)).toHaveLength(1);
    }
    expect(findTraceNodes(result.trace, 'multiply')).toHaveLength(7);
    expect(result.trace.docRef).toBe('box-office.md#forecast');
    expect(result.trace.unit).toBe('count');
  });

  it('has no venue capacity line', () => {
    const labels = topLabels(attendance());
    expect(labels.some((label) => /capacity|venue/i.test(label))).toBe(false);
  });

  it('is a whole number for every show size and popularity', () => {
    for (const importance of EVENT_IMPORTANCES) {
      for (const popularity of [0, 1, 33.3, 50, 99.9, 100]) {
        const value = attendance({ importance, popularity }).value;
        expect(Number.isInteger(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('draws nobody when any show size multiplier is 0 (0 means 0)', () => {
    for (const importance of EVENT_IMPORTANCES) {
      const zero = createEngineTunables({ [`boxOffice.importance.${importance}`]: 0 });
      expect(attendance({ importance, popularity: 100, marketingLevel: 10 }, zero).value).toBe(0);
    }
  });

  it('draws nobody when recent form, fatigue or hype is 0', () => {
    const zero = constantOf('Zero', 0, 'Test');
    expect(attendance({ recentForm: zero }).value).toBe(0);
    expect(attendance({ bigShowFatigue: zero }).value).toBe(0);
    expect(attendance({ hype: zero }).value).toBe(0);
  });

  it('draws nobody with no walk-up crowd and no popularity', () => {
    const noWalkUp = createEngineTunables({ 'boxOffice.draw.walkUp': 0 });
    expect(attendance({ popularity: 0 }, noWalkUp).value).toBe(0);
  });

  it('draws only the walk-up crowd when the full-popularity crowd is 0', () => {
    const none = createEngineTunables({ 'boxOffice.draw.atFullPopularity': 0 });
    expect(attendance({ popularity: 100 }, none).value).toBe(80);
  });

  it('ignores marketing when the per-level rate is 0', () => {
    const none = createEngineTunables({ 'boxOffice.marketing.perLevel': 0 });
    expect(attendance({ marketingLevel: 10 }, none).value).toBe(attendance().value);
  });

  it('is linear in popularity at the lowest curve and steep at the highest', () => {
    const linear = createEngineTunables({ 'boxOffice.draw.curve': 1 });
    expect(attendance({ popularity: 50 }, linear).value).toBe(15_080);
    const steep = createEngineTunables({ 'boxOffice.draw.curve': 6 });
    expect(attendance({ popularity: 50 }, steep).value).toBe(Math.round(80 + 30_000 / 64));
  });

  it('takes the tunables at their maximum', () => {
    const max = createEngineTunables({
      'boxOffice.draw.atFullPopularity': 200_000,
      'boxOffice.draw.walkUp': 5000,
      'boxOffice.marketing.perLevel': 0.5,
      'boxOffice.importance.flagship': 5,
    });
    expect(
      attendance({ popularity: 100, marketingLevel: 10, importance: 'flagship' }, max).value,
    ).toBe(205_000 * 6 * 5);
  });
});
