/**
 * Serialises a world as the golden fixtures store it: the metadata, then every table (in table-name
 * order) as an array of rows in canonical ID order, as 2-space JSON with a trailing newline.
 */

import { compareIds, type ReadonlyTable } from '../../src/model/table';
import type { WorldView } from '../../src/model/world';

export function serialiseWorld(world: WorldView): string {
  const tableEntries: [string, ReadonlyTable][] = Object.entries(world.tables);
  tableEntries.sort(([left], [right]) => compareIds(left, right));
  const tables = Object.fromEntries(tableEntries.map(([name, table]) => [name, table.values()]));
  return `${JSON.stringify({ meta: world.meta, tables }, null, 2)}\n`;
}
