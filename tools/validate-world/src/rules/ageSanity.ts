/**
 * `age-sanity`: everyone is between 16 and 80 on the start date, and nobody debuted before their
 * 15th birthday.
 */

import { addYears, ageInYears, compareDates } from '@ringside/engine';
import type { ValidationIssue } from '../issues';
import { recordIssue, sortedRecords, worldStartDate, type ContentRule } from './helpers';

export const MIN_AGE = 16;
export const MAX_AGE = 80;
/** The youngest age at which a debut is believable. */
export const MIN_DEBUT_AGE = 15;

export const ageSanity: ContentRule = {
  id: 'age-sanity',
  description: `Everyone is ${String(MIN_AGE)}-${String(MAX_AGE)} on the start date and debuted on or after their ${String(MIN_DEBUT_AGE)}th birthday`,
  check(world, content) {
    const start = worldStartDate(world);
    const issues: ValidationIssue[] = [];
    for (const [key, merged] of sortedRecords(content, 'person')) {
      const person = merged.record;
      if (compareDates(person.birthDate, start) > 0) {
        issues.push(
          recordIssue(
            'error',
            'age-sanity',
            'person',
            key,
            merged,
            ['birthDate'],
            `${key} is born on ${person.birthDate}, after the world starts on ${start}`,
          ),
        );
        continue;
      }
      const age = ageInYears(person.birthDate, start);
      if (age < MIN_AGE || age > MAX_AGE) {
        issues.push(
          recordIssue(
            'error',
            'age-sanity',
            'person',
            key,
            merged,
            ['birthDate'],
            `${key} is ${String(age)} on ${start}; everyone must be ${String(MIN_AGE)}-${String(MAX_AGE)}`,
          ),
        );
      }
      if (
        person.debutDate !== null &&
        compareDates(person.debutDate, addYears(person.birthDate, MIN_DEBUT_AGE)) < 0
      ) {
        issues.push(
          recordIssue(
            'error',
            'age-sanity',
            'person',
            key,
            merged,
            ['debutDate'],
            `${key} debuts on ${person.debutDate}, before their ${String(MIN_DEBUT_AGE)}th birthday`,
          ),
        );
      }
    }
    return issues;
  },
};
