import { describe, expect, it } from 'vitest';
import { MAX_GAME_YEAR, MIN_GAME_YEAR, parseGameDate, weekday } from '@ringside/engine';
import type { GameDate } from '@ringside/engine';
import {
  groupByDate,
  isSameMonth,
  monthParamOf,
  monthTitle,
  monthWeeks,
  parseMonthParam,
  shiftMonth,
  weekLabel,
} from './calendarMonth';

const MONDAY = 0;
const SUNDAY = 6;

function day(text: string): GameDate {
  return parseGameDate(text);
}

describe('monthWeeks', () => {
  it('starts every week on a Monday and ends it on a Sunday', () => {
    for (const month of ['2027-01-15', '2028-02-01', '2027-12-31', '2026-08-09']) {
      const weeks = monthWeeks(day(month));
      for (const week of weeks) {
        expect(week).toHaveLength(7);
        expect(weekday(week[0]!)).toBe(MONDAY);
        expect(weekday(week[6]!)).toBe(SUNDAY);
      }
    }
  });

  it('covers a five-week month from the Monday before the 1st to the Sunday after the last', () => {
    // January 2027: the 1st is a Friday, the 31st a Sunday.
    const weeks = monthWeeks(day('2027-01-20'));
    expect(weeks).toHaveLength(5);
    expect(weeks[0]![0]).toBe('2026-12-28');
    expect(weeks[0]![4]).toBe('2027-01-01');
    expect(weeks.at(-1)!.at(-1)).toBe('2027-01-31');
  });

  it('gives a month that starts late in the week six weeks', () => {
    // August 2026: the 1st is a Saturday and the 31st a Monday.
    const weeks = monthWeeks(day('2026-08-01'));
    expect(weeks).toHaveLength(6);
    expect(weeks.flat()).toHaveLength(42);
    expect(weeks[0]![0]).toBe('2026-07-27');
    expect(weeks.at(-1)!.at(-1)).toBe('2026-09-06');
  });

  it('includes the 29th in a leap February and runs on into March', () => {
    // February 2028: the 1st is a Tuesday, the 29th a Tuesday.
    const days = monthWeeks(day('2028-02-10')).flat();
    expect(days).toHaveLength(35);
    expect(days[0]).toBe('2028-01-31');
    expect(days).toContain('2028-02-29');
    expect(days.at(-1)).toBe('2028-03-05');
  });

  it('fits a February that starts on a Monday into exactly four weeks', () => {
    // February 2027 has 28 days and starts on a Monday.
    const days = monthWeeks(day('2027-02-01')).flat();
    expect(days).toHaveLength(28);
    expect(days[0]).toBe('2027-02-01');
    expect(days.at(-1)).toBe('2027-02-28');
  });

  it('crosses a year boundary at both ends', () => {
    // December 2027: the 1st is a Wednesday, the 31st a Friday.
    const december = monthWeeks(day('2027-12-25')).flat();
    expect(december[0]).toBe('2027-11-29');
    expect(december.at(-1)).toBe('2028-01-02');
    // January 2028: the 1st is a Saturday.
    const january = monthWeeks(day('2028-01-01')).flat();
    expect(january[0]).toBe('2027-12-27');
    expect(january.at(-1)).toBe('2028-02-06');
  });

  it('lists every day once, in order', () => {
    const days = monthWeeks(day('2028-02-10')).flat();
    expect([...days].sort()).toEqual(days);
    expect(new Set(days).size).toBe(days.length);
  });
});

describe('groupByDate', () => {
  it('groups rows by date and keeps the order they came in', () => {
    const rows = [
      { date: day('2027-01-04'), name: 'stored one' },
      { date: day('2027-01-05'), name: 'other day' },
      { date: day('2027-01-04'), name: 'stored two' },
      { date: day('2027-01-04'), name: 'projected' },
    ];
    const groups = groupByDate(rows);
    expect([...groups.keys()]).toEqual(['2027-01-04', '2027-01-05']);
    expect(groups.get(day('2027-01-04'))?.map((row) => row.name)).toEqual([
      'stored one',
      'stored two',
      'projected',
    ]);
    expect(groups.get(day('2027-01-06'))).toBeUndefined();
  });

  it('gives an empty map for no rows', () => {
    expect(groupByDate([]).size).toBe(0);
  });
});

describe('weekLabel', () => {
  it('names the week by its Monday', () => {
    expect(weekLabel(day('2027-01-04'))).toBe('Week of Mon 4 Jan');
  });

  it('names a week that starts in the old year by that Monday', () => {
    expect(weekLabel(day('2027-12-27'))).toBe('Week of Mon 27 Dec');
    expect(weekLabel(day('2028-02-28'))).toBe('Week of Mon 28 Feb');
  });
});

describe('month in the URL', () => {
  it('reads a YYYY-MM value as the first of that month', () => {
    expect(parseMonthParam('2027-01')).toBe('2027-01-01');
    expect(parseMonthParam('2028-12')).toBe('2028-12-01');
  });

  it.each([null, '', '2027', '2027-1', '2027-13', '2027-00', '27-01', '2027-01-04', 'next'])(
    'reads %s as no month',
    (value) => {
      expect(parseMonthParam(value)).toBeNull();
    },
  );

  it('leaves out the years at the very ends of the game calendar', () => {
    expect(parseMonthParam(`${String(MIN_GAME_YEAR)}-06`)).toBeNull();
    expect(parseMonthParam(`${String(MAX_GAME_YEAR)}-06`)).toBeNull();
    expect(parseMonthParam(`${String(MIN_GAME_YEAR + 1)}-01`)).not.toBeNull();
    expect(parseMonthParam(`${String(MAX_GAME_YEAR - 1)}-12`)).not.toBeNull();
  });

  it('writes the month of any day back as YYYY-MM', () => {
    expect(monthParamOf(day('2027-01-31'))).toBe('2027-01');
    expect(monthParamOf(day('2028-11-02'))).toBe('2028-11');
    expect(parseMonthParam(monthParamOf(day('2028-02-29')))).toBe('2028-02-01');
  });
});

describe('shiftMonth', () => {
  it('moves to the first of the next and the previous month', () => {
    expect(shiftMonth(day('2027-01-31'), 1)).toBe('2027-02-01');
    expect(shiftMonth(day('2027-03-31'), -1)).toBe('2027-02-01');
  });

  it('crosses a year boundary both ways', () => {
    expect(shiftMonth(day('2027-12-15'), 1)).toBe('2028-01-01');
    expect(shiftMonth(day('2028-01-15'), -1)).toBe('2027-12-01');
  });

  it('stops at the ends of what the calendar shows', () => {
    expect(shiftMonth(day(`${String(MIN_GAME_YEAR + 1)}-01-10`), -1)).toBeNull();
    expect(shiftMonth(day(`${String(MAX_GAME_YEAR - 1)}-12-10`), 1)).toBeNull();
  });
});

describe('isSameMonth and monthTitle', () => {
  it('compares the month and the year', () => {
    expect(isSameMonth(day('2027-01-01'), day('2027-01-31'))).toBe(true);
    expect(isSameMonth(day('2027-01-31'), day('2027-02-01'))).toBe(false);
    expect(isSameMonth(day('2027-01-15'), day('2028-01-15'))).toBe(false);
  });

  it('writes the month with its year', () => {
    expect(monthTitle(day('2027-01-20'))).toBe('January 2027');
    expect(monthTitle(day('2028-02-29'))).toBe('February 2028');
  });
});
