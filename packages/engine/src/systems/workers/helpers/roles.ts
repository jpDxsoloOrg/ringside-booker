/**
 * The roles a person can be rated in, and which one is their main role.
 */

import type { Employment } from '../../../model/entities/employment';
import { PERSON_ROLES, type Person, type PersonRole } from '../../../model/entities/person';

/** Every role a person can be rated in, in display order. */
export const RATING_ROLES = [
  'wrestler',
  'manager',
  'presenter',
  'announcer',
  'referee',
  'producer',
  'booker',
] as const;
export type RatingRole = (typeof RATING_ROLES)[number];

/** The rating role for a person role: an occasional wrestler is rated as a wrestler. */
export function ratingRoleOfPersonRole(role: PersonRole): RatingRole {
  return role === 'occasionalWrestler' ? 'wrestler' : role;
}

/**
 * The role a person is known for: the role their main employer hired them in, or for a free agent
 * the first role they hold in `PERSON_ROLES` order.
 */
export function mainRoleOf(
  person: Pick<Person, 'roles'>,
  primaryEmployment: Pick<Employment, 'role'> | null,
): RatingRole {
  if (primaryEmployment !== null) {
    return primaryEmployment.role;
  }
  const firstRole = PERSON_ROLES.find((role) => person.roles.includes(role));
  // The person schema refuses an empty role list, so this fallback is for hand-built rows only.
  return firstRole === undefined ? 'wrestler' : ratingRoleOfPersonRole(firstRole);
}
