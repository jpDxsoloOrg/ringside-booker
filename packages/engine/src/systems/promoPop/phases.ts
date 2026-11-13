/**
 * The promotion popularity system's day phase: on the 1st of each month, old per-show popularity
 * records are pruned so the save does not grow without end (EVT5-02).
 *
 * Design: docs/design/promotion-popularity.md#after-every-show.
 */

import { addDays, compareDates, startOfMonth, type GameDate } from '../../core/date';
import { definePhase, type PhaseDefinition } from '../../core/pipeline/phase';
import type { EngineTunables } from '../tunables';

/**
 * The first day a show must be on for its record to be kept by the prune that ran on `pruneDay`:
 * `pruneDay − promoPop.keepShowChangesDays`. Rows dated earlier are deleted.
 */
export function keepShowChangesFrom(pruneDay: GameDate, tunables: EngineTunables): GameDate {
  return addDays(pruneDay, -tunables.get('promoPop.keepShowChangesDays'));
}

/**
 * The cutoff of the latest prune on or before `today` (the 1st of today's month): a show dated
 * before it has had its record pruned.
 */
export function lastPruneCutoff(today: GameDate, tunables: EngineTunables): GameDate {
  return keepShowChangesFrom(startOfMonth(today), tunables);
}

/** Deletes `popularityShowChanges` rows dated more than `keepShowChangesDays` before today. */
export const pruneShowChangesPhase: PhaseDefinition = definePhase({
  id: 'promoPop.pruneShowChanges',
  group: 'periodic',
  order: 45,
  cadence: { kind: 'monthly', day: 1 },
  run: (ctx) => {
    const keepFrom = keepShowChangesFrom(ctx.date, ctx.tunables);
    // Table iteration is in ascending id order.
    const stale = [...ctx.read.tables.popularityShowChanges.values()]
      .filter((row) => compareDates(row.date, keepFrom) < 0)
      .map((row) => row.id);
    for (const id of stale) {
      ctx.tx.delete('popularityShowChanges', id);
    }
    if (stale.length > 0) {
      ctx.log(`promoPop: pruned ${String(stale.length)} show popularity records`);
    }
  },
});

export const promoPopPhases: readonly PhaseDefinition[] = [pruneShowChangesPhase];
