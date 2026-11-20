/**
 * Whether anything in the world points at a show. A show that mail, news, the ledger or any other
 * table refers to is cancelled rather than deleted when the schedule changes, because deleting it
 * would leave a dangling reference that `checkWorld` reports and a save load refuses.
 *
 * Design notes: docs/design/calendar.md#schedule-editor.
 */

import type { EventInstanceId } from '../../../core/ids';
import { resolveRefPath } from '../../../model/ref-path';
import { TABLES, type GameWorldView } from '../../../model/tables';
import type { WorldView } from '../../../model/world';

interface RefSource {
  readonly table: string;
  readonly path: string;
}

let sources: readonly RefSource[] | undefined;

/** Every (table, path) whose references point at event instances, apart from the shows themselves. */
function refSources(): readonly RefSource[] {
  if (sources === undefined) {
    const found: RefSource[] = [];
    for (const def of Object.values(TABLES)) {
      if (def.name === 'eventInstances') {
        continue;
      }
      for (const ref of def.refs) {
        if (ref.target === 'eventInstance') {
          found.push({ table: def.name, path: ref.path });
        }
      }
    }
    sources = found;
  }
  return sources;
}

/**
 * The ids out of `candidates` that some row in the world refers to. One pass over each table that
 * can point at a show, so it costs the same for one candidate as for many.
 */
export function referencedInstances(
  read: GameWorldView,
  candidates: ReadonlySet<EventInstanceId>,
): Set<EventInstanceId> {
  const referenced = new Set<EventInstanceId>();
  if (candidates.size === 0) {
    return referenced;
  }
  const byText = new Map<string, EventInstanceId>([...candidates].map((id) => [id, id]));
  const view: WorldView = read;
  for (const source of refSources()) {
    const table = view.tables[source.table];
    if (table === undefined) {
      continue;
    }
    for (const row of table.values()) {
      for (const found of resolveRefPath(row, source.path)) {
        const id = typeof found.value === 'string' ? byText.get(found.value) : undefined;
        if (id !== undefined) {
          referenced.add(id);
        }
      }
    }
  }
  return referenced;
}

/** True when any row in the world refers to the show. */
export function instanceIsReferenced(read: GameWorldView, id: EventInstanceId): boolean {
  return referencedInstances(read, new Set([id])).size > 0;
}
