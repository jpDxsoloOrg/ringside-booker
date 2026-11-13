/**
 * Prunes the rival decision log: deletes every row past `aip.decisionLogRetentionDays`.
 *
 * The log is `appendOnly: 'pruneOnly'`, so this delete is the only change a row ever sees. The
 * turn runner (AIP1-03) calls it once a day; until then nothing writes decisions, so nothing needs
 * pruning. Keeping the log to a fixed window keeps a long game's save from growing with it. See
 * docs/design/rival-desk.md#decision-log.
 */

import type { GameDate } from '../../../core/date';
import type { GameTables } from '../../../model/tables';
import type { Tx } from '../../../model/tx';
import { isDecisionExpired } from '../formulas/decisionLogCutoff';

/** Deletes the expired decisions and returns how many went. */
export function pruneDecisionLog(
  tx: Tx<GameTables>,
  today: GameDate,
  retentionDays: number,
): number {
  const expired = [...tx.view.tables.aiDecisions.values()].filter((decision) =>
    isDecisionExpired(decision.date, decision.revealOn, today, retentionDays),
  );
  for (const decision of expired) {
    tx.delete('aiDecisions', decision.id);
  }
  return expired.length;
}
