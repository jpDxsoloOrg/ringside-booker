/**
 * Reading tables owned by other schema files without importing their definitions.
 *
 * Some invariants here check a field on a row of another kind (a promotion's `status`, an event
 * definition's `promotionId`). Those tables are defined by their own schema files, which can land in
 * any order, so these invariants find the table by entity kind and read the one field they need,
 * narrowing it from `unknown`. When the table is not registered, or its rows do not carry the field
 * (a test stub), the check has nothing to compare and reports nothing; the reference checks already
 * report missing rows.
 */

import { isId, type EntityKind } from '../../core/ids';
import type { ReadonlyTable } from '../table';
import type { WorldView } from '../world';

/** The table holding rows of `kind`, or undefined when the world has none. */
export function findTableOfKind(view: WorldView, kind: EntityKind): ReadonlyTable | undefined {
  return Object.values(view.tables).find((table) => table.kind === kind);
}

/** The string value of `field` on the row with `id` in the table of `kind`, or null if absent. */
export function readSiblingString(
  view: WorldView,
  kind: EntityKind,
  id: string,
  field: string,
): string | null {
  const table = findTableOfKind(view, kind);
  if (table === undefined) {
    return null;
  }
  const row = isId(kind, id) ? table.get(id) : undefined;
  if (row === undefined) {
    return null;
  }
  const value: unknown = Reflect.get(row, field);
  return typeof value === 'string' ? value : null;
}
