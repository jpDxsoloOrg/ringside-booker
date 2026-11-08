import { describe, expect, it } from 'vitest';
import {
  cadenceSchema,
  defineCadence,
  describeCadence,
  isWeekdayName,
  matchesCadence,
  nextOccurrence,
  WEEKDAY_NAMES,
  weekdayFromName,
  weekdayName,
  type Cadence,
} from '../../../src/core/calendar';
import {
  addDays,
  dayOfMonth,
  makeGameDate,
  parseGameDate,
  weekday,
  year,
  type GameDate,
  type Weekday,
} from '../../../src/core/date';
import { EngineError, InvalidCadenceError } from '../../../src/core/errors';
import { hashString32 } from '../../../src/core/hash';
import * as engine from '../../../src/index';

const date = (text: string): GameDate => parseGameDate(text);

/** Every date of `targetYear`, in order. */
function daysOfYear(targetYear: number): GameDate[] {
  const days: GameDate[] = [];
  for (let current = makeGameDate(targetYear, 1, 1); year(current) === targetYear;) {
    days.push(current);
    current = addDays(current, 1);
  }
  return days;
}

/** The dates of `targetYear` on which `cadence` runs. */
function matchingDays(targetYear: number, cadence: Cadence): GameDate[] {
  return daysOfYear(targetYear).filter((day) => matchesCadence(day, cadence));
}

const ALL_WEEKDAYS: readonly Weekday[] = [0, 1, 2, 3, 4, 5, 6];

/** Cadences that slip past the type checker, as they would from JSON or a data pack. */
const AMBIGUOUS_CADENCES: readonly { readonly label: string; readonly input: unknown }[] = [
  { label: 'monthly day 31', input: { kind: 'monthly', day: 31 } },
  { label: 'monthly day 29', input: { kind: 'monthly', day: 29 } },
  { label: 'monthly day 0', input: { kind: 'monthly', day: 0 } },
  { label: 'monthly day 1.5', input: { kind: 'monthly', day: 1.5 } },
  { label: 'yearly 29 February', input: { kind: 'yearly', month: 2, day: 29 } },
  { label: 'yearly 31 April', input: { kind: 'yearly', month: 4, day: 31 } },
  { label: 'yearly month 13', input: { kind: 'yearly', month: 13, day: 1 } },
  { label: 'yearly month 0', input: { kind: 'yearly', month: 0, day: 1 } },
  { label: 'weekly unknown weekday', input: { kind: 'weekly', weekday: 'monday' } },
  { label: 'unknown kind', input: { kind: 'fortnightly' } },
];

/**
 * Narrows unchecked input to the Cadence type without validating it, so the tests can hand the
 * runtime checks exactly what a hand-edited data pack might contain.
 */
function uncheckedCadence(input: unknown): Cadence {
  return input as Cadence; // eslint-disable-line @typescript-eslint/no-unsafe-type-assertion -- deliberately invalid test input
}

describe('weekday names', () => {
  it('maps every Weekday number to its name and back', () => {
    for (const dayOfWeek of ALL_WEEKDAYS) {
      const name = weekdayName(dayOfWeek);
      expect(WEEKDAY_NAMES[dayOfWeek]).toBe(name);
      expect(weekdayFromName(name)).toBe(dayOfWeek);
    }
  });

  it('numbers Monday as 0, matching weekday()', () => {
    expect(weekday(date('2024-01-01'))).toBe(0);
    expect(weekdayName(weekday(date('2024-01-01')))).toBe('mon');
    expect(weekdayName(weekday(date('2024-01-07')))).toBe('sun');
  });

  it('recognises only the seven short names', () => {
    expect(WEEKDAY_NAMES.every(isWeekdayName)).toBe(true);
    expect(isWeekdayName('Monday')).toBe(false);
    expect(isWeekdayName('toString')).toBe(false);
    expect(isWeekdayName(0)).toBe(false);
  });
});

describe('matchesCadence', () => {
  it('daily matches all 366 days of 2024', () => {
    expect(matchingDays(2024, defineCadence({ kind: 'daily' }))).toHaveLength(366);
  });

  it('weekly mon matches 52 or 53 days in each year 2024-2030, all of them Mondays', () => {
    const mondays = defineCadence({ kind: 'weekly', weekday: 'mon' });
    for (let targetYear = 2024; targetYear <= 2030; targetYear += 1) {
      const matches = matchingDays(targetYear, mondays);
      expect([52, 53]).toContain(matches.length);
      expect(matches.every((day) => weekday(day) === 0)).toBe(true);
      const allMondays = daysOfYear(targetYear).filter((day) => weekday(day) === 0);
      expect(matches).toEqual(allMondays);
    }
  });

  it('weekly matches only its own weekday for every name', () => {
    for (const name of WEEKDAY_NAMES) {
      const cadence = defineCadence({ kind: 'weekly', weekday: name });
      const matches = matchingDays(2025, cadence);
      expect(matches.every((day) => weekday(day) === weekdayFromName(name))).toBe(true);
    }
  });

  it('monthly day 1 matches 12 times a year, always on the 1st', () => {
    const firsts = defineCadence({ kind: 'monthly', day: 1 });
    for (const targetYear of [2023, 2024]) {
      const matches = matchingDays(targetYear, firsts);
      expect(matches).toHaveLength(12);
      expect(matches.every((day) => dayOfMonth(day) === 1)).toBe(true);
    }
  });

  it('monthly 28 matches in February of common and leap years', () => {
    const cadence = defineCadence({ kind: 'monthly', day: 28 });
    expect(matchesCadence(date('2023-02-28'), cadence)).toBe(true);
    expect(matchesCadence(date('2024-02-28'), cadence)).toBe(true);
    expect(matchingDays(2024, cadence)).toHaveLength(12);
  });

  it("monthly 'last' matches the last day of each month, leap years included", () => {
    const lastDay = defineCadence({ kind: 'monthly', day: 'last' });
    expect(matchesCadence(date('2024-02-29'), lastDay)).toBe(true);
    expect(matchesCadence(date('2023-02-28'), lastDay)).toBe(true);
    expect(matchesCadence(date('2024-02-28'), lastDay)).toBe(false);
    expect(matchesCadence(date('2024-04-30'), lastDay)).toBe(true);
    expect(matchesCadence(date('2024-12-31'), lastDay)).toBe(true);
    expect(matchingDays(2024, lastDay)).toHaveLength(12);
  });

  it('yearly 1 January matches once a year', () => {
    const newYear = defineCadence({ kind: 'yearly', month: 1, day: 1 });
    for (let targetYear = 2023; targetYear <= 2026; targetYear += 1) {
      expect(matchingDays(targetYear, newYear)).toEqual([makeGameDate(targetYear, 1, 1)]);
    }
  });

  it('yearly 31 December matches once a year', () => {
    const yearEnd = defineCadence({ kind: 'yearly', month: 12, day: 31 });
    expect(matchingDays(2024, yearEnd)).toEqual([date('2024-12-31')]);
  });

  it('refuses an ambiguous cadence instead of silently skipping days', () => {
    expect(() =>
      matchesCadence(date('2024-01-31'), uncheckedCadence({ kind: 'monthly', day: 31 })),
    ).toThrow(InvalidCadenceError);
  });
});

describe('defineCadence', () => {
  it('accepts every valid kind and returns a frozen copy', () => {
    const valid: readonly Cadence[] = [
      { kind: 'daily' },
      { kind: 'weekly', weekday: 'sun' },
      { kind: 'monthly', day: 1 },
      { kind: 'monthly', day: 28 },
      { kind: 'monthly', day: 'last' },
      { kind: 'yearly', month: 2, day: 28 },
      { kind: 'yearly', month: 12, day: 31 },
    ];
    for (const cadence of valid) {
      const defined = defineCadence(cadence);
      expect(defined).toEqual(cadence);
      expect(defined).not.toBe(cadence);
      expect(Object.isFrozen(defined)).toBe(true);
    }
  });

  it.each(AMBIGUOUS_CADENCES)('throws InvalidCadenceError for $label', ({ input }) => {
    expect(() => defineCadence(uncheckedCadence(input))).toThrow(InvalidCadenceError);
  });

  it('names the bad field and suggests last for a monthly day above 28', () => {
    let caught: unknown;
    try {
      defineCadence({ kind: 'monthly', day: 31 });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(EngineError);
    if (!(caught instanceof InvalidCadenceError)) {
      throw new Error('expected an InvalidCadenceError');
    }
    const cadenceError = caught;
    expect(cadenceError.code).toBe('INVALID_CADENCE');
    expect(cadenceError.message).toContain('monthly.day');
    expect(cadenceError.message).toContain("'last'");
    expect(cadenceError.details).toMatchObject({ field: 'monthly.day', value: '31' });
  });

  it('names the field and explains the leap day for yearly 29 February', () => {
    expect(() => defineCadence({ kind: 'yearly', month: 2, day: 29 })).toThrow(/yearly\.day/);
    expect(() => defineCadence({ kind: 'yearly', month: 2, day: 29 })).toThrow(/leap years/);
    expect(() => defineCadence({ kind: 'yearly', month: 13, day: 1 })).toThrow(/yearly\.month/);
  });
});

describe('cadenceSchema', () => {
  it('accepts the valid kinds', () => {
    expect(cadenceSchema.parse({ kind: 'daily' })).toEqual({ kind: 'daily' });
    expect(cadenceSchema.parse({ kind: 'weekly', weekday: 'fri' })).toEqual({
      kind: 'weekly',
      weekday: 'fri',
    });
    expect(cadenceSchema.parse({ kind: 'monthly', day: 'last' })).toEqual({
      kind: 'monthly',
      day: 'last',
    });
    expect(cadenceSchema.parse({ kind: 'yearly', month: 1, day: 1 })).toEqual({
      kind: 'yearly',
      month: 1,
      day: 1,
    });
  });

  it.each(AMBIGUOUS_CADENCES)('rejects $label', ({ input }) => {
    expect(cadenceSchema.safeParse(input).success).toBe(false);
  });

  it('reports the same field and reason as defineCadence', () => {
    const result = cadenceSchema.safeParse({ kind: 'monthly', day: 31 });
    expect(result.success).toBe(false);
    const issue = result.error?.issues[0];
    expect(issue?.path).toEqual(['day']);
    expect(issue?.message).toContain('monthly.day');
    expect(issue?.message).toContain("'last'");
  });

  it('rejects unknown fields so a misspelt key is not ignored', () => {
    expect(
      cadenceSchema.safeParse({ kind: 'weekly', weekday: 'mon', weekDay: 'tue' }).success,
    ).toBe(false);
  });
});

describe('nextOccurrence', () => {
  const fridays = defineCadence({ kind: 'weekly', weekday: 'fri' });

  it('returns the same day when `from` already matches', () => {
    expect(weekdayName(weekday(date('2024-03-01')))).toBe('fri');
    expect(nextOccurrence(date('2024-03-01'), fridays)).toBe(date('2024-03-01'));
  });

  it('returns the following Friday from a Saturday', () => {
    expect(nextOccurrence(date('2024-03-02'), fridays)).toBe(date('2024-03-08'));
  });

  it("finds the last day of a common-year February for monthly 'last'", () => {
    const lastDay = defineCadence({ kind: 'monthly', day: 'last' });
    expect(nextOccurrence(date('2023-02-01'), lastDay)).toBe(date('2023-02-28'));
    expect(nextOccurrence(date('2024-02-01'), lastDay)).toBe(date('2024-02-29'));
  });

  it('reaches a yearly date a full leap year away', () => {
    const newYear = defineCadence({ kind: 'yearly', month: 1, day: 1 });
    expect(nextOccurrence(date('2024-01-02'), newYear)).toBe(date('2025-01-01'));
    expect(nextOccurrence(date('2023-12-31'), newYear)).toBe(date('2024-01-01'));
  });

  it('throws for an ambiguous cadence', () => {
    expect(() =>
      nextOccurrence(date('2024-01-01'), uncheckedCadence({ kind: 'yearly', month: 2, day: 29 })),
    ).toThrow(InvalidCadenceError);
  });
});

describe('describeCadence', () => {
  it.each<{ cadence: Cadence; text: string }>([
    { cadence: { kind: 'daily' }, text: 'every day' },
    { cadence: { kind: 'weekly', weekday: 'mon' }, text: 'every Monday' },
    { cadence: { kind: 'weekly', weekday: 'sun' }, text: 'every Sunday' },
    { cadence: { kind: 'monthly', day: 1 }, text: 'on the 1st of each month' },
    { cadence: { kind: 'monthly', day: 2 }, text: 'on the 2nd of each month' },
    { cadence: { kind: 'monthly', day: 3 }, text: 'on the 3rd of each month' },
    { cadence: { kind: 'monthly', day: 11 }, text: 'on the 11th of each month' },
    { cadence: { kind: 'monthly', day: 12 }, text: 'on the 12th of each month' },
    { cadence: { kind: 'monthly', day: 13 }, text: 'on the 13th of each month' },
    { cadence: { kind: 'monthly', day: 21 }, text: 'on the 21st of each month' },
    { cadence: { kind: 'monthly', day: 22 }, text: 'on the 22nd of each month' },
    { cadence: { kind: 'monthly', day: 23 }, text: 'on the 23rd of each month' },
    { cadence: { kind: 'monthly', day: 'last' }, text: 'on the last day of each month' },
    { cadence: { kind: 'yearly', month: 1, day: 1 }, text: 'every year on 1 January' },
    { cadence: { kind: 'yearly', month: 12, day: 31 }, text: 'every year on 31 December' },
  ])('describes $text', ({ cadence, text }) => {
    expect(describeCadence(cadence)).toBe(text);
  });
});

describe('time-zone independence', () => {
  /**
   * Every matching date for one cadence of each kind over 2023-2025, hashed. The test script runs
   * this file again under TZ=Pacific/Kiritimati (UTC+14) and TZ=America/St_Johns (UTC-3:30, with
   * daylight saving), and every run must produce this same value.
   */
  const EXPECTED_FINGERPRINT = 1_927_433_566;

  const FINGERPRINT_CADENCES: readonly Cadence[] = [
    { kind: 'daily' },
    ...WEEKDAY_NAMES.map((name): Cadence => ({ kind: 'weekly', weekday: name })),
    { kind: 'monthly', day: 1 },
    { kind: 'monthly', day: 15 },
    { kind: 'monthly', day: 28 },
    { kind: 'monthly', day: 'last' },
    { kind: 'yearly', month: 1, day: 1 },
    { kind: 'yearly', month: 2, day: 28 },
    { kind: 'yearly', month: 12, day: 31 },
  ];

  function cadenceFingerprint(): number {
    const lines = FINGERPRINT_CADENCES.map((cadence) => {
      const matches = [2023, 2024, 2025].flatMap((targetYear) => matchingDays(targetYear, cadence));
      return `${describeCadence(cadence)}: ${matches.join(',')}`;
    });
    return hashString32(lines.join('\n'));
  }

  it('runs in the time zone the test script asked for', () => {
    const requestedZone = process.env['TZ'];
    if (requestedZone !== undefined && requestedZone !== '') {
      expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(requestedZone);
    }
  });

  it('gives the same results in every time zone', () => {
    expect(cadenceFingerprint()).toBe(EXPECTED_FINGERPRINT);
  });
});

describe('public API', () => {
  it('exports the cadence surface from the engine entry point', () => {
    expect(engine.defineCadence).toBe(defineCadence);
    expect(engine.matchesCadence).toBe(matchesCadence);
    expect(engine.nextOccurrence).toBe(nextOccurrence);
    expect(engine.describeCadence).toBe(describeCadence);
    expect(engine.cadenceSchema).toBe(cadenceSchema);
    expect(engine.InvalidCadenceError).toBe(InvalidCadenceError);
  });
});
