/**
 * Roster size (DAY2-03): the people under an active contract that has started, one line per role
 * with anyone in it ("Wrestlers 44"), summed. The counts follow the same rule as the history row's
 * `rosterSize` (active employments with `startsOn` on or before today).
 *
 * Design: docs/design/office.md#kpis-and-deltas.
 */

import { startCalc, type Traced } from '../../../core/trace';
import { EMPLOYMENT_ROLES, type EmploymentRole } from '../../../model/entities/employment';

export const ROSTER_SIZE_DOC_REF = 'office.md#kpis-and-deltas';

/** Each role's plural name, for Why? lines and footers. */
export const ROLE_PLURAL_LABELS: Readonly<Record<EmploymentRole, string>> = {
  wrestler: 'Wrestlers',
  manager: 'Managers',
  presenter: 'Presenters',
  announcer: 'Announcers',
  referee: 'Referees',
  producer: 'Producers',
  booker: 'Bookers',
};

/** The plain inputs of {@link rosterSize}. */
export interface RosterSizeInputs {
  /** People under contract per role. */
  readonly byRole: Readonly<Record<EmploymentRole, number>>;
}

/** The roster's size: every role's count, added up. */
export function rosterSize(inputs: RosterSizeInputs): Traced<number> {
  const calc = startCalc('Roster size', 0, {
    unit: 'count',
    docRef: ROSTER_SIZE_DOC_REF,
    startLabel: 'Nobody yet',
  });
  for (const role of EMPLOYMENT_ROLES) {
    const count = inputs.byRole[role];
    if (count > 0) {
      calc.add(ROLE_PLURAL_LABELS[role], count);
    }
  }
  return calc.done();
}
