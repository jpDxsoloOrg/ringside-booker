import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  addYears,
  ageInYears,
  compareDates,
  dayOfMonth,
  daysInMonth,
  diffDays,
  endOfMonth,
  fromEpochDay,
  isAfter,
  isBefore,
  isGameDate,
  isLastDayOfMonth,
  isLeapYear,
  makeGameDate,
  month,
  nthWeekdayOfMonth,
  parseGameDate,
  startOfMonth,
  toEpochDay,
  weekday,
  year,
  zWeekday,
  type GameDate,
} from '../../src/core/date';
import { InvalidArgumentError, InvalidDateError } from '../../src/core/errors';

const date = (text: string): GameDate => parseGameDate(text);

describe('leap years', () => {
  it('follows the Gregorian rule', () => {
    expect(isLeapYear(2000)).toBe(true);
    expect(isLeapYear(1900)).toBe(false);
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2100)).toBe(false);
    expect(isLeapYear(2023)).toBe(false);
  });

  it('gives February the right length', () => {
    expect(daysInMonth(2000, 2)).toBe(29);
    expect(daysInMonth(1900, 2)).toBe(28);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2100, 2)).toBe(28);
    expect(daysInMonth(2024, 4)).toBe(30);
    expect(daysInMonth(2024, 12)).toBe(31);
    expect(() => daysInMonth(2024, 13)).toThrow(InvalidArgumentError);
  });
});

describe('parseGameDate / isGameDate', () => {
  it('accepts valid dates at the edges of the range', () => {
    expect(parseGameDate('1900-01-01')).toBe('1900-01-01');
    expect(parseGameDate('2999-12-31')).toBe('2999-12-31');
    expect(parseGameDate('2024-02-29')).toBe('2024-02-29');
  });

  it('rejects impossible and malformed dates', () => {
    for (const bad of [
      '2023-02-29',
      '2024-13-01',
      '24-01-01',
      '2024-00-10',
      '2024-04-31',
      '2024-1-01',
      '1899-12-31',
      '3000-01-01',
      '2024-01-01T00:00',
      ' 2024-01-01',
    ]) {
      expect(() => parseGameDate(bad), bad).toThrow(InvalidDateError);
      expect(isGameDate(bad), bad).toBe(false);
    }
    expect(() => parseGameDate(20_240_101)).toThrow(InvalidDateError);
    expect(isGameDate(null)).toBe(false);
  });

  it('builds a date from parts', () => {
    expect(makeGameDate(2024, 2, 29)).toBe('2024-02-29');
    expect(() => makeGameDate(2023, 2, 29)).toThrow(InvalidDateError);
  });
});

describe('epoch days', () => {
  it('counts from 1970-01-01', () => {
    expect(toEpochDay(date('1970-01-01'))).toBe(0);
    expect(toEpochDay(date('1970-01-02'))).toBe(1);
    expect(toEpochDay(date('1969-12-31'))).toBe(-1);
    expect(toEpochDay(date('2000-03-01'))).toBe(11_017);
  });

  it('round-trips every day from 1990-01-01 to 2100-12-31', () => {
    // Walk the calendar with independent month lengths and check each day is one after the last.
    const monthLengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let expectedEpochDay = toEpochDay(date('1990-01-01'));
    let checkedDays = 0;
    for (let yearNumber = 1990; yearNumber <= 2100; yearNumber += 1) {
      const leap = yearNumber % 4 === 0 && (yearNumber % 100 !== 0 || yearNumber % 400 === 0);
      for (let monthNumber = 1; monthNumber <= 12; monthNumber += 1) {
        const length = monthNumber === 2 && leap ? 29 : (monthLengths[monthNumber - 1] ?? 0);
        for (let dayNumber = 1; dayNumber <= length; dayNumber += 1) {
          const text = `${yearNumber}-${String(monthNumber).padStart(2, '0')}-${String(dayNumber).padStart(2, '0')}`;
          const gameDate = date(text);
          const epochDay = toEpochDay(gameDate);
          if (epochDay !== expectedEpochDay || fromEpochDay(epochDay) !== text) {
            expect.fail(`${text}: epoch day ${epochDay}, expected ${expectedEpochDay}`);
          }
          expectedEpochDay += 1;
          checkedDays += 1;
        }
      }
    }
    expect(checkedDays).toBe(40_542);
  });

  it('round-trips the ends of the supported range', () => {
    for (const text of ['1900-01-01', '1900-03-01', '2999-12-31']) {
      expect(fromEpochDay(toEpochDay(date(text)))).toBe(text);
    }
  });

  it('refuses days outside 1900-2999', () => {
    const first = toEpochDay(date('1900-01-01'));
    const last = toEpochDay(date('2999-12-31'));
    expect(() => fromEpochDay(first - 1)).toThrow(InvalidDateError);
    expect(() => fromEpochDay(last + 1)).toThrow(InvalidDateError);
    expect(() => fromEpochDay(1.5)).toThrow(InvalidArgumentError);
  });
});

describe('addDays / diffDays / comparisons', () => {
  it('crosses month, leap day and year boundaries', () => {
    expect(addDays(date('2024-02-28'), 1)).toBe('2024-02-29');
    expect(addDays(date('2024-02-29'), 1)).toBe('2024-03-01');
    expect(addDays(date('2023-02-28'), 1)).toBe('2023-03-01');
    expect(addDays(date('2023-12-31'), 1)).toBe('2024-01-01');
    expect(addDays(date('2024-01-01'), -1)).toBe('2023-12-31');
    expect(addDays(date('2024-01-01'), 366)).toBe('2025-01-01');
  });

  it('rejects fractional day counts and leaving the range', () => {
    expect(() => addDays(date('2024-01-01'), 0.5)).toThrow(InvalidArgumentError);
    expect(() => addDays(date('2999-12-31'), 1)).toThrow(InvalidDateError);
  });

  it('measures days and is negative when reversed', () => {
    const start = date('2024-01-01');
    const end = date('2024-03-01');
    expect(diffDays(start, end)).toBe(60);
    expect(diffDays(end, start)).toBe(-60);
    expect(diffDays(start, start)).toBe(0);
  });

  it('compares dates', () => {
    const earlier = date('2024-01-31');
    const later = date('2024-02-01');
    expect(compareDates(earlier, later)).toBe(-1);
    expect(compareDates(later, earlier)).toBe(1);
    expect(compareDates(earlier, earlier)).toBe(0);
    expect(isBefore(earlier, later)).toBe(true);
    expect(isBefore(earlier, earlier)).toBe(false);
    expect(isAfter(later, earlier)).toBe(true);
    expect(isAfter(later, later)).toBe(false);
  });
});

describe('addMonths / addYears', () => {
  it('clamps to the end of a shorter month', () => {
    expect(addMonths(date('2024-01-31'), 1)).toBe('2024-02-29');
    expect(addMonths(date('2023-01-31'), 1)).toBe('2023-02-28');
    expect(addMonths(date('2024-03-31'), 1)).toBe('2024-04-30');
    expect(addMonths(date('2024-03-31'), -1)).toBe('2024-02-29');
  });

  it('crosses years in both directions', () => {
    expect(addMonths(date('2024-11-15'), 3)).toBe('2025-02-15');
    expect(addMonths(date('2024-01-15'), -1)).toBe('2023-12-15');
    expect(addMonths(date('2024-01-15'), -25)).toBe('2021-12-15');
    expect(addMonths(date('2024-01-15'), 0)).toBe('2024-01-15');
  });

  it('moves whole years and clamps 29 February', () => {
    expect(addYears(date('2024-02-29'), 1)).toBe('2025-02-28');
    expect(addYears(date('2024-02-29'), 4)).toBe('2028-02-29');
    expect(addYears(date('2024-06-01'), -10)).toBe('2014-06-01');
  });

  it('refuses to leave the supported range', () => {
    expect(() => addMonths(date('2999-12-01'), 1)).toThrow(InvalidDateError);
    expect(() => addYears(date('1900-06-01'), -1)).toThrow(InvalidDateError);
  });
});

describe('weekday and month helpers', () => {
  it('numbers weekdays from Monday', () => {
    expect(weekday(date('2024-01-01'))).toBe(0);
    expect(weekday(date('2024-01-07'))).toBe(6);
    expect(weekday(date('1970-01-01'))).toBe(3);
    expect(weekday(date('1900-01-01'))).toBe(0);
    expect(weekday(date('2000-02-29'))).toBe(1);
  });

  it('validates weekdays with zWeekday', () => {
    expect(zWeekday.safeParse(0).success).toBe(true);
    expect(zWeekday.safeParse(6).success).toBe(true);
    expect(zWeekday.safeParse(7).success).toBe(false);
    expect(zWeekday.safeParse(-1).success).toBe(false);
    expect(zWeekday.safeParse(1.5).success).toBe(false);
  });

  it('reads the parts of a date', () => {
    const sample = date('2024-07-09');
    expect(year(sample)).toBe(2024);
    expect(month(sample)).toBe(7);
    expect(dayOfMonth(sample)).toBe(9);
  });

  it('finds the start and end of a month', () => {
    expect(startOfMonth(date('2024-02-17'))).toBe('2024-02-01');
    expect(endOfMonth(date('2024-02-17'))).toBe('2024-02-29');
    expect(endOfMonth(date('2023-02-17'))).toBe('2023-02-28');
    expect(isLastDayOfMonth(date('2024-02-29'))).toBe(true);
    expect(isLastDayOfMonth(date('2024-02-28'))).toBe(false);
    expect(isLastDayOfMonth(date('2023-02-28'))).toBe(true);
  });

  it('finds the nth weekday of a month', () => {
    expect(nthWeekdayOfMonth(2025, 3, 6, 'last')).toBe('2025-03-30');
    expect(nthWeekdayOfMonth(2025, 3, 5, 'last')).toBe('2025-03-29');
    expect(nthWeekdayOfMonth(2025, 3, 0, 'last')).toBe('2025-03-31');
    expect(nthWeekdayOfMonth(2025, 3, 0, 1)).toBe('2025-03-03');
    expect(nthWeekdayOfMonth(2025, 3, 5, 1)).toBe('2025-03-01');
    expect(nthWeekdayOfMonth(2025, 3, 1, 2)).toBe('2025-03-11');
    expect(nthWeekdayOfMonth(2025, 3, 0, 5)).toBe('2025-03-31');
    expect(nthWeekdayOfMonth(2025, 2, 0, 5)).toBeNull();
    expect(() => nthWeekdayOfMonth(2025, 0, 0, 1)).toThrow(InvalidArgumentError);
  });
});

describe('ageInYears', () => {
  it('goes up on the birthday, not the day before', () => {
    const birth = date('1990-06-15');
    expect(ageInYears(birth, date('2024-06-14'))).toBe(33);
    expect(ageInYears(birth, date('2024-06-15'))).toBe(34);
    expect(ageInYears(birth, date('2024-12-31'))).toBe(34);
    expect(ageInYears(birth, birth)).toBe(0);
  });

  it('counts a 29 February birthday on 1 March in common years', () => {
    const birth = date('2000-02-29');
    expect(ageInYears(birth, date('2023-02-28'))).toBe(22);
    expect(ageInYears(birth, date('2023-03-01'))).toBe(23);
    expect(ageInYears(birth, date('2024-02-28'))).toBe(23);
    expect(ageInYears(birth, date('2024-02-29'))).toBe(24);
  });

  it('refuses a today before the birth date', () => {
    expect(() => ageInYears(date('2000-01-02'), date('2000-01-01'))).toThrow(InvalidDateError);
  });
});
