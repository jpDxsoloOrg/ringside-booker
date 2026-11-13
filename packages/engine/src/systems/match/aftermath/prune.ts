/**
 * The weekly prune of stored aftermaths (MTCH3-03): each worker keeps only their newest
 * `match.aftermath.keepPerPerson` rows, so saves do not grow with every match ever run. Results
 * pages and Recent form only ever show recent matches; older ones are summed up in the worker's
 * record and popularity already.
 *
 * Newest first is the latest date, then the latest row on that date (rows are written in card
 * order, and IDs are minted in order). Runs on Mondays in the `periodic` group.
 *
 * Design: docs/design/match-aftermath.md#stored-aftermaths.
 */

import { compareDates } from '../../../core/date';
import type { AftermathId, PersonId } from '../../../core/ids';
import { definePhase, type PhaseDefinition } from '../../../core/pipeline/phase';
import type { Aftermath } from '../../../model/entities/aftermath';
import { compareIds } from '../../../model/table';
import type { GameWorldView } from '../../../model/tables';
import type { DeepReadonly } from '../../../model/world';

/** The rows to delete so each person keeps at most `keep` of their newest. In ID order. */
export function aftermathsToPrune(read: GameWorldView, keep: number): AftermathId[] {
  const byPerson = new Map<PersonId, DeepReadonly<Aftermath>[]>();
  for (const row of read.tables.aftermaths.values()) {
    const rows = byPerson.get(row.personId);
    if (rows === undefined) {
      byPerson.set(row.personId, [row]);
    } else {
      rows.push(row);
    }
  }
  const pruned: AftermathId[] = [];
  for (const rows of byPerson.values()) {
    if (rows.length <= keep) {
      continue;
    }
    rows.sort(
      (left, right) => compareDates(right.date, left.date) || compareIds(right.id, left.id),
    );
    for (const row of rows.slice(keep)) {
      pruned.push(row.id);
    }
  }
  return pruned.sort(compareIds);
}

export const pruneAftermathsPhase: PhaseDefinition = definePhase({
  id: 'match.pruneAftermaths',
  group: 'periodic',
  order: 40,
  cadence: { kind: 'weekly', weekday: 'mon' },
  run: (ctx) => {
    const keep = ctx.tunables.get('match.aftermath.keepPerPerson');
    for (const id of aftermathsToPrune(ctx.read, keep)) {
      ctx.tx.delete('aftermaths', id);
    }
  },
});
