// Age and experience helpers. Design: docs/design/data-model.md, "Stored and derived"
import { describe, expect, it } from 'vitest';
import { parseGameDate } from '../../../src/core/date';
import { ageOn, experienceYears } from '../../../src/systems/workers';
import { aPerson } from '../../support/builders/people';

const date = parseGameDate;

describe('ageOn', () => {
  const person = aPerson({ birthDate: date('1996-06-15'), debutDate: date('2016-06-15') });

  it('counts whole years, turning over on the birthday', () => {
    expect(ageOn(person, date('2026-06-14'))).toBe(29);
    expect(ageOn(person, date('2026-06-15'))).toBe(30);
    expect(ageOn(person, date('2026-06-16'))).toBe(30);
  });

  it('is 0 on the day of birth', () => {
    expect(ageOn(person, date('1996-06-15'))).toBe(0);
  });

  it('counts a 29 February birthday from 1 March in a common year', () => {
    const leapling = aPerson({ birthDate: date('2000-02-29'), debutDate: date('2018-03-01') });
    expect(ageOn(leapling, date('2026-02-28'))).toBe(25);
    expect(ageOn(leapling, date('2026-03-01'))).toBe(26);
  });
});

describe('experienceYears', () => {
  const person = aPerson({ birthDate: date('1996-06-15'), debutDate: date('2016-06-15') });

  it('is the years since the debut, with the part of a year as a fraction', () => {
    expect(experienceYears(person, date('2026-06-15'))).toBe(10);
    const midYear = experienceYears(person, date('2026-12-15'));
    expect(midYear).toBeGreaterThan(10.4);
    expect(midYear).toBeLessThan(10.6);
  });

  it('is 0 on the debut day, before the debut and for someone who has not debuted', () => {
    expect(experienceYears(person, date('2016-06-15'))).toBe(0);
    expect(experienceYears(person, date('2010-01-01'))).toBe(0);
    expect(experienceYears(aPerson({ debutDate: null }), date('2026-06-15'))).toBe(0);
  });
});
