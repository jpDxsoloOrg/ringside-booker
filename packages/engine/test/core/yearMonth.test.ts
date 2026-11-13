// Year-months: YYYY-MM months for month-by-month books (ECO1-03). Design: docs/design/finances.md#queries
import { describe, expect, it } from 'vitest';
import {
  addYearMonths,
  firstDayOfYearMonth,
  isYearMonth,
  parseGameDate,
  yearMonthOf,
  type YearMonth,
} from '../../src/core/date';
import { InvalidArgumentError } from '../../src/core/errors';
import { zYearMonth } from '../../src/model/primitives';

function month(text: string): YearMonth {
  if (!isYearMonth(text)) throw new Error(`not a month: ${text}`);
  return text;
}

describe('year-months', () => {
  it('accepts YYYY-MM for months 01 to 12 in the game years only', () => {
    for (const valid of ['2026-01', '2028-02', '2999-12', '1900-01']) {
      expect(isYearMonth(valid), valid).toBe(true);
      expect(zYearMonth.safeParse(valid).success, valid).toBe(true);
    }
    for (const invalid of [
      '2026-00',
      '2026-13',
      '2026-1',
      '26-01',
      '2026-01-01',
      '1899-12',
      '3000-01',
      202601,
      null,
    ]) {
      expect(isYearMonth(invalid), String(invalid)).toBe(false);
      expect(zYearMonth.safeParse(invalid).success, String(invalid)).toBe(false);
    }
  });

  it('reads the month of a date, leap day included', () => {
    expect(yearMonthOf(parseGameDate('2028-02-29'))).toBe('2028-02');
    expect(yearMonthOf(parseGameDate('2026-12-31'))).toBe('2026-12');
  });

  it('moves by whole months across year ends, both ways', () => {
    expect(addYearMonths(month('2027-12'), 1)).toBe('2028-01');
    expect(addYearMonths(month('2028-01'), -1)).toBe('2027-12');
    expect(addYearMonths(month('2026-03'), -11)).toBe('2025-04');
    expect(addYearMonths(month('2026-03'), 24)).toBe('2028-03');
    expect(addYearMonths(month('2026-03'), 0)).toBe('2026-03');
    expect(() => addYearMonths(month('2026-03'), 1.5)).toThrow(InvalidArgumentError);
  });

  it('gives the first day of a month', () => {
    expect(firstDayOfYearMonth(month('2028-02'))).toBe('2028-02-01');
  });
});
