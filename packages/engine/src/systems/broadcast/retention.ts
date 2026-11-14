/**
 * How long airing rows are kept (ECO8-04), under the owner's history rule (POL4-08): the last
 * `history.keepDetailDays` in full, older play as summaries.
 *
 * An airing row is already a summary (no per-segment detail), but every promotion writes one per
 * televised show. So:
 *
 * - **Rivals** (`rollUpAirings`, step 7 of the weekly `history.rollUp`): rows of computer-run
 *   promotions dated before the detail window are deleted. What they said lives on as totals: the
 *   money in the ledger's monthly totals, each completed show's viewers on its result
 *   (`result.viewers`).
 * - **The player** (`broadcast.pruneAirings`, monthly): rows older than
 *   `broadcast.airing.historyDays` are deleted. The deal screens list the player's own airings
 *   for over a year.
 *
 * Either way, each deal's newest `broadcast.airing.keepPerDeal` rows stay whatever their age, so
 * deal health (ECO8-05) and rivals' deal making (ECO10) always read a full window. Ledger rows, not
 * airings, are the permanent money record.
 *
 * Design: docs/design/broadcast.md#retention.
 */

import { addDays, compareDates, type GameDate } from '../../core/date';
import type { AiringId, PromotionId } from '../../core/ids';
import type { StepContext } from '../../core/pipeline/context';
import { definePhase, type PhaseDefinition } from '../../core/pipeline/phase';
import type { GameWorldView } from '../../model/tables';
import { isHumanControlled } from './traces';

export const PRUNE_AIRINGS_PHASE_ID = 'broadcast.pruneAirings';

/** Each deal's newest `perDeal` airings (by air date, then id), which are never deleted. */
export function newestAiringsPerDeal(read: GameWorldView, perDeal: number): Set<AiringId> {
  const keep = new Set<AiringId>();
  for (const dealId of read.tables.deals.ids()) {
    const rows = [...read.tables.airings.lookup('byDeal', dealId)].sort(
      (left, right) => compareDates(right.airDate, left.airDate) || (left.id < right.id ? 1 : -1),
    );
    for (const row of rows.slice(0, perDeal)) {
      keep.add(row.id);
    }
  }
  return keep;
}

/** Deletes the airings `doomed` picks, keeping each deal's newest; returns how many went. */
function deleteAirings(
  ctx: Pick<StepContext, 'read' | 'tx' | 'tunables'>,
  doomed: (row: { airDate: GameDate; promotionId: PromotionId }) => boolean,
): number {
  const { read } = ctx;
  const candidates = read.tables.airings.values().filter(doomed);
  if (candidates.length === 0) {
    return 0;
  }
  const keep = newestAiringsPerDeal(read, ctx.tunables.get('broadcast.airing.keepPerDeal'));
  let deleted = 0;
  for (const row of candidates) {
    if (!keep.has(row.id)) {
      ctx.tx.delete('airings', row.id);
      deleted += 1;
    }
  }
  return deleted;
}

/**
 * History roll-up step: deletes computer-run promotions' airings dated before `from` (the start of
 * the detail window), except each deal's newest. Returns how many went.
 */
export function rollUpAirings(
  ctx: Pick<StepContext, 'read' | 'tx' | 'tunables'>,
  from: GameDate,
): number {
  const human = new Map<PromotionId, boolean>();
  const isHuman = (promotionId: PromotionId): boolean => {
    let value = human.get(promotionId);
    if (value === undefined) {
      const promotion = ctx.read.tables.promotions.get(promotionId);
      value = promotion !== undefined && isHumanControlled(promotion);
      human.set(promotionId, value);
    }
    return value;
  };
  return deleteAirings(
    ctx,
    (row) => compareDates(row.airDate, from) < 0 && !isHuman(row.promotionId),
  );
}

/** Monthly: deletes airings older than `broadcast.airing.historyDays`, except each deal's newest. */
export const pruneAiringsPhase: PhaseDefinition = definePhase({
  id: PRUNE_AIRINGS_PHASE_ID,
  group: 'periodic',
  order: 47,
  cadence: { kind: 'monthly', day: 1 },
  run: (ctx) => {
    const before = addDays(ctx.date, -ctx.tunables.get('broadcast.airing.historyDays'));
    const deleted = deleteAirings(ctx, (row) => compareDates(row.airDate, before) < 0);
    if (deleted > 0) {
      ctx.log(`Deleted ${String(deleted)} airing(s) older than ${before}`);
    }
  },
});
