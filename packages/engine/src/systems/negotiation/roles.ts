/**
 * Roles a worker will not take (ECO5-03): a real wrestler will not give up the ring for a job
 * outside it, and nobody takes a job they have never done.
 *
 * - holds `wrestler` with a wrestler rating of `contracts.react.refuseCrewRoleRating` or more, and
 *   is offered any other role → "Wants to wrestle";
 * - does not hold the offered role (an occasional wrestler counts as a wrestler) → "Has never
 *   worked as a referee". The booker's job is not a person role, so anyone may be offered it.
 *
 * Design: docs/design/negotiation.md#reaction.
 */

import type { EmploymentRole } from '../../model/entities/employment';
import { PERSON_ROLES, type Person } from '../../model/entities/person';
import type { EngineTunables } from '../tunables';
import { overallOf } from '../workers/formulas/roleRating';
import { ratingRoleOfPersonRole } from '../workers/helpers/roles';
import { ROLE_WORDS } from './formulas/shared';

export const WANTS_TO_WRESTLE = 'Wants to wrestle';

/** "Has never worked as a referee". */
export function neverWorkedAs(role: EmploymentRole): string {
  const word = ROLE_WORDS[role];
  const article = /^[aeiou]/.test(word) ? 'an' : 'a';
  return `Has never worked as ${article} ${word}`;
}

function isPersonRole(role: EmploymentRole): boolean {
  return PERSON_ROLES.some((personRole) => personRole === role);
}

/** Why `person` will not take `role`, or null when they will. */
export function roleMismatch(
  person: Person,
  role: EmploymentRole,
  deps: { tunables: EngineTunables },
): string | null {
  if (
    role !== 'wrestler' &&
    person.roles.includes('wrestler') &&
    overallOf(person, 'wrestler', deps).value >=
      deps.tunables.get('contracts.react.refuseCrewRoleRating')
  ) {
    return WANTS_TO_WRESTLE;
  }
  if (!isPersonRole(role)) {
    return null;
  }
  const holds = person.roles.some((held) => ratingRoleOfPersonRole(held) === role);
  return holds ? null : neverWorkedAs(role);
}
