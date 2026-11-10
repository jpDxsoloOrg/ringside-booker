/**
 * Age and experience, read off a person's dates. Both are derived on every read and never stored.
 *
 * Design: docs/design/data-model.md, "Stored and derived".
 */

import { ageInYears, type GameDate } from '../../../core/date';
import type { Person } from '../../../model/entities/person';
import { experienceYearsAt } from '../../world/people/dates';

/** The person's age on `date`, in whole years. */
export function ageOn(person: Pick<Person, 'birthDate'>, date: GameDate): number {
  return ageInYears(person.birthDate, date);
}

/**
 * Years since the person's debut on `date`, as a fraction; 0 for someone who has not debuted yet
 * (or whose debut is still ahead).
 */
export function experienceYears(person: Pick<Person, 'debutDate'>, date: GameDate): number {
  return experienceYearsAt(person.debutDate, date);
}
