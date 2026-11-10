// A recurrence in words. Design: docs/design/calendar.md#queries
import { describe, expect, it } from 'vitest';
import { parseGameDate } from '../../../src/core/date';
import type { Recurrence } from '../../../src/model/entities/event-definition';
import { recurrenceText } from '../../../src/systems/calendar';

describe('recurrenceText', () => {
  it('names the weekday of a weekly show', () => {
    expect(recurrenceText({ kind: 'weekly', weekdays: [0] })).toBe('Every Monday');
    expect(recurrenceText({ kind: 'weekly', weekdays: [6] })).toBe('Every Sunday');
  });

  it('lists several weekdays Monday first, whatever order they are stored in', () => {
    expect(recurrenceText({ kind: 'weekly', weekdays: [3, 0] })).toBe('Every Monday and Thursday');
    expect(recurrenceText({ kind: 'weekly', weekdays: [4, 0, 2] })).toBe(
      'Every Monday, Wednesday and Friday',
    );
  });

  it('says "Every day" for a show on all seven weekdays', () => {
    expect(recurrenceText({ kind: 'weekly', weekdays: [0, 1, 2, 3, 4, 5, 6] })).toBe('Every day');
  });

  it('gives the interval and weekday of an every-N-weeks show', () => {
    expect(
      recurrenceText({
        kind: 'everyNWeeks',
        intervalWeeks: 2,
        weekday: 5,
        anchor: parseGameDate('2026-01-10'),
      }),
    ).toBe('Every 2 weeks on Saturday');
  });

  it('gives the week and weekday of a monthly show', () => {
    expect(recurrenceText({ kind: 'monthly', week: 'last', weekday: 6 })).toBe(
      'Last Sunday of every month',
    );
    expect(recurrenceText({ kind: 'monthly', week: 1, weekday: 4 })).toBe(
      '1st Friday of every month',
    );
    expect(recurrenceText({ kind: 'monthly', week: 3, weekday: 2 })).toBe(
      '3rd Wednesday of every month',
    );
  });

  it('gives the week, weekday and month of an annual show', () => {
    expect(recurrenceText({ kind: 'annual', month: 2, week: 2, weekday: 6 })).toBe(
      '2nd Sunday of February every year',
    );
    expect(recurrenceText({ kind: 'annual', month: 12, week: 'last', weekday: 5 })).toBe(
      'Last Saturday of December every year',
    );
    expect(recurrenceText({ kind: 'annual', month: 1, week: 4, weekday: 0 })).toBe(
      '4th Monday of January every year',
    );
  });

  it('counts the dates of a show on set dates', () => {
    const one: Recurrence = { kind: 'dates', dates: [parseGameDate('2026-03-01')] };
    const three: Recurrence = {
      kind: 'dates',
      dates: ['2026-03-01', '2026-06-01', '2026-09-01'].map(parseGameDate),
    };
    expect(recurrenceText(one)).toBe('On 1 set date');
    expect(recurrenceText(three)).toBe('On 3 set dates');
  });

  it('never mentions a clock time or a length', () => {
    const texts = [
      recurrenceText({ kind: 'weekly', weekdays: [0, 3] }),
      recurrenceText({ kind: 'monthly', week: 'last', weekday: 6 }),
      recurrenceText({ kind: 'annual', month: 2, week: 2, weekday: 6 }),
    ];
    for (const text of texts) {
      expect(text).not.toMatch(/minute|hour|\d:\d|\bam\b|\bpm\b/i);
    }
  });
});
