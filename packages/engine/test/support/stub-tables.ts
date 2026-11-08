import { z } from 'zod';
import type { EntityKind, IdOf } from '../../src/core/ids';
import { zId } from '../../src/model/primitives';
import { defineTable, type TableDef } from '../../src/model/table-def';

/**
 * A placeholder table for an entity kind whose real schema has not landed yet: rows are just
 * `{ id }`, with no refs, indexes or invariants. Schema tickets register stubs for sibling kinds
 * they reference, so their reference checks have a table to resolve against.
 */
export function stubTable<K extends EntityKind>(
  kind: K,
  name: string,
): TableDef<K, { id: IdOf<K> }> {
  return defineTable({
    kind,
    name,
    schema: z.strictObject({ id: zId(kind) }),
    refs: [],
    indexes: [],
  });
}
