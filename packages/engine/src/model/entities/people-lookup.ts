/**
 * Reads the few person facts that group and employment invariants need, without importing the
 * person schema.
 *
 * Teams and stables must not keep a deceased member while active. The check only needs a person's
 * `status`, so it reads the `people` table by name and narrows the field at runtime. That keeps
 * these tables independent of the person module (and testable with a minimal people table); a
 * world without a `people` table simply has nobody to report.
 */

import type { PersonId } from '../../core/ids';
import type { WorldView } from '../world';

export const PEOPLE_TABLE_NAME = 'people';

/** The person status that ends every group membership. */
export const DECEASED_STATUS = 'deceased';

/** True when the world has a person `personId` whose `status` is deceased. */
export function isDeceased(view: WorldView, personId: PersonId): boolean {
  const people = view.tables[PEOPLE_TABLE_NAME];
  if (people === undefined) {
    return false;
  }
  const person = people.get(personId);
  if (person === undefined) {
    return false;
  }
  const status: unknown = Reflect.get(person, 'status');
  return status === DECEASED_STATUS;
}
