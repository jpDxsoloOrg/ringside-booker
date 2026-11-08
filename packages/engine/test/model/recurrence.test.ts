import { describe, expect, it } from 'vitest';
import { addDays, parseGameDate, weekday, type GameDate } from '../../src/core/date';
import { RecurrenceSchema, type Recurrence } from '../../src/model/entities/event-definition';
import { nextOccurrence, occursOn } from '../../src/model/recurrence';

const date = (value: string): GameDate => parseGameDate(value);

// Weekday numbering: 0 = Monday .. 6 = Sunday.
const MONDAY = 0;
const WEDNESDAY = 2;
const THURSDAY = 3;
const SATURDAY = 5;
const SUNDAY = 6;

function parse(recurrence: Recurrence): Recurrence {
  return RecurrenceSchema.parse(recurrence);
}

describe('weekly', () => {
  const mondayAndThursday = parse({ kind: 'weekly', weekdays: [MONDAY, THURSDAY] });

  it('occurs on its weekdays only', () => {
    expect(weekday(date('2026-01-05'))).toBe(MONDAY);
    expect(occursOn(mondayAndThursday, date('2026-01-05'))).toBe(true);
    expect(occursOn(mondayAndThursday, date('2026-01-06'))).toBe(false);
    expect(occursOn(mondayAndThursday, date('2026-01-08'))).toBe(true);
  });

  it('finds the next show day after a date', () => {
    expect(nextOccurrence(mondayAndThursday, date('2026-01-05'))).toBe(date('2026-01-08'));
    expect(nextOccurrence(mondayAndThursday, date('2026-01-08'))).toBe(date('2026-01-12'));
  });

  it('crosses a year boundary', () => {
    // 2026-12-31 is a Thursday; the next Monday is 2027-01-04.
    expect(nextOccurrence(mondayAndThursday, date('2026-12-31'))).toBe(date('2027-01-04'));
  });
});

describe('everyNWeeks', () => {
  const everyOtherWednesday = parse({
    kind: 'everyNWeeks',
    intervalWeeks: 2,
    weekday: WEDNESDAY,
    anchor: date('2026-01-07'),
  });

  it('occurs on the anchor and every interval after it', () => {
    expect(occursOn(everyOtherWednesday, date('2026-01-07'))).toBe(true);
    expect(occursOn(everyOtherWednesday, date('2026-01-21'))).toBe(true);
    expect(occursOn(everyOtherWednesday, date('2026-02-04'))).toBe(true);
  });

  it('skips the off weeks and never occurs before the anchor', () => {
    expect(occursOn(everyOtherWednesday, date('2026-01-14'))).toBe(false);
    expect(occursOn(everyOtherWednesday, date('2025-12-24'))).toBe(false);
  });

  it('returns the anchor as the next show for any earlier date', () => {
    expect(nextOccurrence(everyOtherWednesday, date('2025-12-24'))).toBe(date('2026-01-07'));
    expect(nextOccurrence(everyOtherWednesday, date('2026-01-06'))).toBe(date('2026-01-07'));
  });

  it('lands 20 days later from the day after a show when shows are 3 weeks apart', () => {
    const everyThirdWeek = parse({
      kind: 'everyNWeeks',
      intervalWeeks: 3,
      weekday: WEDNESDAY,
      anchor: date('2026-01-07'),
    });
    const dayAfter = addDays(date('2026-01-28'), 1);
    expect(occursOn(everyThirdWeek, date('2026-01-28'))).toBe(true);
    expect(nextOccurrence(everyThirdWeek, dayAfter)).toBe(addDays(dayAfter, 20));
  });

  it('crosses a year boundary', () => {
    // 2026-12-23 and 2027-01-06 are 50 and 52 weeks after the anchor; 2026-12-30 (51) is not.
    expect(nextOccurrence(everyOtherWednesday, date('2026-12-25'))).toBe(date('2027-01-06'));
  });

  it('fails to parse when the anchor is not on its weekday', () => {
    const result = RecurrenceSchema.safeParse({
      kind: 'everyNWeeks',
      intervalWeeks: 2,
      weekday: WEDNESDAY,
      anchor: date('2026-01-08'),
    });
    expect(result.success).toBe(false);
  });
});

describe('monthly', () => {
  it('finds the last Sunday in a month with five Sundays', () => {
    // March 2026 has Sundays on the 1st, 8th, 15th, 22nd and 29th.
    const lastSunday = parse({ kind: 'monthly', week: 'last', weekday: SUNDAY });
    expect(occursOn(lastSunday, date('2026-03-29'))).toBe(true);
    expect(occursOn(lastSunday, date('2026-03-22'))).toBe(false);
    expect(nextOccurrence(lastSunday, date('2026-03-01'))).toBe(date('2026-03-29'));
    expect(nextOccurrence(lastSunday, date('2026-03-29'))).toBe(date('2026-04-26'));
  });

  it('crosses a year boundary', () => {
    const firstMonday = parse({ kind: 'monthly', week: 1, weekday: MONDAY });
    expect(nextOccurrence(firstMonday, date('2026-12-15'))).toBe(date('2027-01-04'));
  });
});

describe('annual', () => {
  const secondSaturdayOfJune = parse({ kind: 'annual', month: 6, week: 2, weekday: SATURDAY });

  it('occurs on the 2nd Saturday of June only', () => {
    // June 2026 starts on a Monday, so its Saturdays are the 6th and 13th.
    expect(occursOn(secondSaturdayOfJune, date('2026-06-13'))).toBe(true);
    expect(occursOn(secondSaturdayOfJune, date('2026-06-06'))).toBe(false);
    expect(occursOn(secondSaturdayOfJune, date('2026-07-11'))).toBe(false);
  });

  it('finds this year or next year', () => {
    expect(nextOccurrence(secondSaturdayOfJune, date('2026-01-01'))).toBe(date('2026-06-13'));
    expect(nextOccurrence(secondSaturdayOfJune, date('2026-06-13'))).toBe(date('2027-06-12'));
  });
});

describe('dates', () => {
  const tour = parse({ kind: 'dates', dates: [date('2026-03-01'), date('2026-03-04')] });

  it('matches the listed dates exactly', () => {
    expect(occursOn(tour, date('2026-03-01'))).toBe(true);
    expect(occursOn(tour, date('2026-03-02'))).toBe(false);
    expect(occursOn(tour, date('2026-03-04'))).toBe(true);
  });

  it('returns the next listed date and null once the list is exhausted', () => {
    expect(nextOccurrence(tour, date('2026-02-01'))).toBe(date('2026-03-01'));
    expect(nextOccurrence(tour, date('2026-03-01'))).toBe(date('2026-03-04'));
    expect(nextOccurrence(tour, date('2026-03-04'))).toBeNull();
  });
});

describe('end of the supported calendar', () => {
  it('returns null instead of throwing past the last game date', () => {
    const weekly = parse({ kind: 'weekly', weekdays: [MONDAY] });
    expect(nextOccurrence(weekly, date('2999-12-31'))).toBeNull();
    const monthly = parse({ kind: 'monthly', week: 1, weekday: MONDAY });
    expect(nextOccurrence(monthly, date('2999-12-31'))).toBeNull();
    const annual = parse({ kind: 'annual', month: 1, week: 1, weekday: MONDAY });
    expect(nextOccurrence(annual, date('2999-12-31'))).toBeNull();
  });
});

describe('public API', () => {
  it('exports the recurrence helpers under the recurrence namespace', async () => {
    const engine = await import('../../src/index');
    expect(engine.recurrence.occursOn).toBe(occursOn);
    expect(engine.recurrence.nextOccurrence).toBe(nextOccurrence);
  });
});
