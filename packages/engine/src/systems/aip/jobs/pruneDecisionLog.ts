/**
 * Prunes the rival decision log: deletes every row past `aip.decisionLogRetentionDays`.
 *
 * The log is `appendOnly: 'pruneOnly'`, so this delete is the only change a row ever sees. The
 * daily phase `aip.pruneDecisionLog` (`phases.ts`) runs `pruneDecisionLogOn`, which reads only
 * the rows that can have expired today through the indexes; on the 1st of each month it runs the
 * full sweep `pruneDecisionLog` as well, which catches rows left by a lowered retention or a day
 * whose prune failed. Keeping the log to a fixed window keeps a long game's save from growing with
 * it. See docs/design/rival-desk.md#decision-log.
 */

import type { GameDate } from '../../../core/date';
import type { AiDecisionId } from '../../../core/ids';
import { aiDecisionDateKey, type AiDecision } from '../../../model/entities/ai-decision';
import { compareIds } from '../../../model/table';
import type { GameTables } from '../../../model/tables';
import type { Tx } from '../../../model/tx';
import type { DeepReadonly } from '../../../model/world';
import { decisionLogPruneThrough, isDecisionExpired } from '../formulas/decisionLogCutoff';

function deleteExpired(
  tx: Tx<GameTables>,
  candidates: Iterable<DeepReadonly<AiDecision>>,
  today: GameDate,
  retentionDays: number,
): number {
  const expired = [...candidates]
    .filter((decision) => isDecisionExpired(decision.date, decision.revealOn, today, retentionDays))
    .map((decision) => decision.id)
    .sort(compareIds);
  for (const id of expired) {
    tx.delete('aiDecisions', id);
  }
  return expired.length;
}

/** Deletes every expired decision, in ID order, and returns how many went. A full sweep. */
export function pruneDecisionLog(
  tx: Tx<GameTables>,
  today: GameDate,
  retentionDays: number,
): number {
  return deleteExpired(tx, tx.view.tables.aiDecisions.values(), today, retentionDays);
}

/**
 * Deletes the decisions that expire on `today` when the log is pruned every day, in ID order, and
 * returns how many went. Reads two kinds of rows through the indexes, never the whole table:
 *
 * - each promotion's rows dated exactly `today - retentionDays` (`byPromotionDate`): every older
 *   revealed row went on an earlier day;
 * - the rows revealed today (`byRevealOn`) that are already past the window: a plan that aired
 *   after its row's retention ran out goes the day it airs.
 */
export function pruneDecisionLogOn(
  tx: Tx<GameTables>,
  today: GameDate,
  retentionDays: number,
): number {
  const decisions = tx.view.tables.aiDecisions;
  if (decisions.size === 0) {
    return 0;
  }
  const pruneThrough = decisionLogPruneThrough(today, retentionDays);
  const candidates = new Map<AiDecisionId, DeepReadonly<AiDecision>>();
  for (const promotionId of tx.view.tables.promotions.ids()) {
    for (const decision of decisions.lookup(
      'byPromotionDate',
      aiDecisionDateKey(promotionId, pruneThrough),
    )) {
      candidates.set(decision.id, decision);
    }
  }
  for (const decision of decisions.lookup('byRevealOn', today)) {
    candidates.set(decision.id, decision);
  }
  return deleteExpired(tx, candidates.values(), today, retentionDays);
}
