import { cents, parseGameDate } from '@ringside/engine';
import { afterEach, describe, expect, it } from 'vitest';
import {
  formatDaysBetween,
  formatGameDate,
  formatMoney,
  formatNumber,
  formatPercent,
  formatShortGameDateParts,
  formatSigned,
  MINUS_SIGN,
} from './format';

/** Whole dollars as cents, so the tests read in dollars. */
function dollars(amount: number): ReturnType<typeof cents> {
  return cents(amount * 100);
}

describe('formatMoney', () => {
  it('formats the ticket example in both styles', () => {
    expect(formatMoney(cents(123456700))).toBe('$1,234,567');
    expect(formatMoney(cents(123456700), { style: 'compact' })).toBe('$1.2M');
  });

  it('shows zero as $0', () => {
    expect(formatMoney(cents(0))).toBe('$0');
    expect(formatMoney(cents(0), { style: 'compact' })).toBe('$0');
    expect(formatMoney(cents(0), { showCents: true })).toBe('$0.00');
  });

  it.each([
    [999, '$999'],
    [1_000, '$1K'],
    [1_250, '$1.3K'],
    [999_999, '$1M'],
    [1_000_000, '$1M'],
    [2_500_000_000, '$2.5B'],
  ])('compacts $%i as %s', (amount, expected) => {
    expect(formatMoney(dollars(amount), { style: 'compact' })).toBe(expected);
  });

  it.each([
    [999, '$999'],
    [1_000, '$1,000'],
    [999_999, '$999,999'],
    [1_000_000, '$1,000,000'],
  ])('writes $%i in full as %s', (amount, expected) => {
    expect(formatMoney(dollars(amount))).toBe(expected);
  });

  it('writes negatives with a true minus sign', () => {
    expect(formatMoney(cents(-123456700), { style: 'compact' })).toBe(`${MINUS_SIGN}$1.2M`);
    expect(formatMoney(cents(-123456700))).toBe(`${MINUS_SIGN}$1,234,567`);
    expect(formatMoney(cents(-5), { showCents: true })).toBe(`${MINUS_SIGN}$0.05`);
  });

  it('never shows a minus on an amount that rounds to $0', () => {
    expect(formatMoney(cents(-49))).toBe('$0');
  });

  it('rounds to the nearest whole dollar unless cents are asked for', () => {
    expect(formatMoney(cents(149))).toBe('$1');
    expect(formatMoney(cents(150))).toBe('$2');
    expect(formatMoney(cents(-150))).toBe(`${MINUS_SIGN}$2`);
    expect(formatMoney(cents(123456789), { showCents: true })).toBe('$1,234,567.89');
    expect(formatMoney(cents(7), { showCents: true })).toBe('$0.07');
  });

  it('cannot produce a floating-point artefact', () => {
    // 10 + 20 cents is 30 cents exactly; dollars as floats would give 0.30000000000000004.
    expect(formatMoney(cents(10 + 20), { showCents: true })).toBe('$0.30');
    expect(formatMoney(cents(Number.MAX_SAFE_INTEGER), { showCents: true })).toBe(
      '$90,071,992,547,409.91',
    );
  });
});

describe('formatNumber', () => {
  it('groups thousands and uses a true minus sign', () => {
    expect(formatNumber(12345)).toBe('12,345');
    expect(formatNumber(-12345)).toBe(`${MINUS_SIGN}12,345`);
    expect(formatNumber(3.14159, { maximumFractionDigits: 2 })).toBe('3.14');
  });

  it('pads to the fewest decimals asked for', () => {
    expect(formatNumber(34, { minimumFractionDigits: 1, maximumFractionDigits: 1 })).toBe('34.0');
    expect(formatNumber(0.1, { minimumFractionDigits: 2 })).toBe('0.10');
  });
});

describe('formatPercent', () => {
  it('turns a ratio into a percentage with fixed decimals', () => {
    expect(formatPercent(0.5)).toBe('50%');
    expect(formatPercent(0.125, 1)).toBe('12.5%');
    expect(formatPercent(0.1, 2)).toBe('10.00%');
    expect(formatPercent(-0.05)).toBe(`${MINUS_SIGN}5%`);
  });
});

describe('formatSigned', () => {
  it('always shows the sign of a change', () => {
    expect(formatSigned(6)).toBe('+6');
    expect(formatSigned(-3)).toBe(`${MINUS_SIGN}3`);
    expect(formatSigned(0)).toBe('0');
    expect(formatSigned(-0)).toBe('0');
    expect(formatSigned(1500)).toBe('+1,500');
  });

  it('shows 0 for a change that rounds away', () => {
    expect(formatSigned(0.2)).toBe('0');
    expect(formatSigned(0.25, { maximumFractionDigits: 1 })).toBe('+0.3');
    expect(formatSigned(0.004, { minimumFractionDigits: 2, maximumFractionDigits: 2 })).toBe('0');
    expect(formatSigned(0.1, { minimumFractionDigits: 2, maximumFractionDigits: 2 })).toBe('+0.10');
  });
});

describe('formatGameDate', () => {
  const originalTimeZone = process.env['TZ'];

  afterEach(() => {
    if (originalTimeZone === undefined) {
      delete process.env['TZ'];
    } else {
      process.env['TZ'] = originalTimeZone;
    }
  });

  it('writes short and long dates', () => {
    const date = parseGameDate('2031-01-01');
    expect(formatGameDate(date)).toBe('Jan 1, 2031');
    expect(formatGameDate(date, 'long')).toBe('Wednesday, January 1, 2031');
  });

  it('writes the day-first styles: weekday, day, month, then the year when asked', () => {
    const monday = parseGameDate('2027-01-04');
    expect(formatGameDate(monday, 'dayMonth')).toBe('Mon 4 Jan');
    expect(formatGameDate(monday, 'dayMonthYear')).toBe('Mon 4 Jan 2027');
  });

  it('keeps the day-first styles right across a year boundary', () => {
    expect(formatGameDate(parseGameDate('2027-12-30'), 'dayMonth')).toBe('Thu 30 Dec');
    expect(formatGameDate(parseGameDate('2027-12-30'), 'dayMonthYear')).toBe('Thu 30 Dec 2027');
    expect(formatGameDate(parseGameDate('2027-12-31'), 'dayMonthYear')).toBe('Fri 31 Dec 2027');
    expect(formatGameDate(parseGameDate('2028-01-01'), 'dayMonthYear')).toBe('Sat 1 Jan 2028');
  });

  it.each(['America/Los_Angeles', 'Pacific/Auckland', 'UTC'])(
    'never shifts the day-first styles in the %s time zone',
    (timeZone) => {
      process.env['TZ'] = timeZone;
      expect(formatGameDate(parseGameDate('2028-01-01'), 'dayMonth')).toBe('Sat 1 Jan');
      expect(formatGameDate(parseGameDate('2027-12-31'), 'dayMonthYear')).toBe('Fri 31 Dec 2027');
    },
  );

  it.each(['America/Los_Angeles', 'Pacific/Auckland', 'UTC'])(
    'never shifts the day in the %s time zone',
    (timeZone) => {
      process.env['TZ'] = timeZone;
      const newYearsDay = parseGameDate('2031-01-01');

      expect(formatGameDate(newYearsDay)).toBe('Jan 1, 2031');
      expect(formatGameDate(newYearsDay, 'long')).not.toContain('December');
      expect(formatGameDate(parseGameDate('2030-12-31'))).toBe('Dec 31, 2030');
    },
  );

  it('really runs in a shifted zone during the time zone checks', () => {
    // Proves the TZ switch takes effect: local midnight UTC on New Year's Day is still
    // New Year's Eve in Los Angeles, which is the bug the UTC formatter avoids.
    process.env['TZ'] = 'America/Los_Angeles';
    expect(new Date(Date.UTC(2031, 0, 1)).getDate()).toBe(31);
  });
});

describe('formatShortGameDateParts', () => {
  it('splits the short date before its year', () => {
    expect(formatShortGameDateParts(parseGameDate('2031-01-01'))).toEqual({
      monthDay: 'Jan 1',
      year: ', 2031',
    });
  });

  it.each(['2026-04-10', '2030-12-31', '2031-01-01'])(
    'joins back into the short date %s',
    (iso) => {
      const date = parseGameDate(iso);
      const { monthDay, year } = formatShortGameDateParts(date);
      expect(`${monthDay}${year}`).toBe(formatGameDate(date));
    },
  );
});

describe('formatDaysBetween', () => {
  const today = parseGameDate('2031-03-10');

  it.each([
    ['2031-03-10', 'today'],
    ['2031-03-11', 'tomorrow'],
    ['2031-03-15', 'in 5 days'],
    ['2031-03-09', 'yesterday'],
    ['2031-03-01', '9 days ago'],
    ['2032-03-10', 'in 366 days'],
  ])('describes %s as %s', (target, expected) => {
    expect(formatDaysBetween(today, parseGameDate(target))).toBe(expected);
  });
});
