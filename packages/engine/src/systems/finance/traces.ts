/**
 * The finance system's trace kinds and the refs its traces are stored under.
 *
 * Ledger rows of human-controlled and computer-controlled promotions use separate kinds, so eleven
 * rival payrolls never push the player's rows out of `sim.traceRetentionPerKind`. Every row keeps
 * its trace's ref in `traceRef`. See docs/design/finances.md#postmoney.
 */

import { CASH_TRACE_KIND } from '../../core/api/builtins';
import type { PromotionId } from '../../core/ids';
import type { TraceRef } from '../../core/trace/store';
import type { LedgerEntry } from '../../model/entities/ledger-entry';

/** A ledger row of a human-controlled promotion. Id: the ledger entry id. */
export const LEDGER_ENTRY_TRACE_KIND = 'finance.entry';
/** A ledger row of a computer-controlled promotion. Id: the ledger entry id. */
export const RIVAL_LEDGER_ENTRY_TRACE_KIND = 'finance.rivalEntry';
/**
 * A promotion's cash balance explained (`cashTrace.ts`). Id: the promotion id. The core owns the
 * string, because `sim.status` reads it without importing this system.
 */
export { CASH_TRACE_KIND };

/** Every trace kind the finance system stores. */
export const FINANCE_TRACE_KINDS = [
  LEDGER_ENTRY_TRACE_KIND,
  RIVAL_LEDGER_ENTRY_TRACE_KIND,
  CASH_TRACE_KIND,
] as const;

/** Where a ledger row's trace is stored: its own kind for human-controlled promotions. */
export function ledgerEntryTraceRef(
  entry: Pick<LedgerEntry, 'id'>,
  humanControlled: boolean,
): TraceRef {
  return {
    kind: humanControlled ? LEDGER_ENTRY_TRACE_KIND : RIVAL_LEDGER_ENTRY_TRACE_KIND,
    id: entry.id,
  };
}

/** Where the trace explaining a promotion's cash balance is stored. */
export function cashTraceRef(promotionId: PromotionId): TraceRef {
  return { kind: CASH_TRACE_KIND, id: promotionId };
}
