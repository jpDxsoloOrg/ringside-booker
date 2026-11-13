/**
 * The finance system's domain events. Payloads carry ids and primitives only.
 * See docs/design/finances.md#postmoney.
 */

import type { GameDate } from '../../core/date';
import type { LedgerEntryId, PromotionId } from '../../core/ids';
import type { LedgerCategory } from '../../model/entities/ledger-entry';
import type { PolicyArea } from '../../model/entities/promotion';

declare module '../../core/events/types' {
  interface DomainEventMap {
    /**
     * `postMoney` wrote a ledger row and moved the promotion's cash by `amount` (signed cents).
     * Published only for human-controlled promotions, so rival payrolls never crowd the event log.
     */
    'finance.moneyPosted': {
      promotionId: PromotionId;
      ledgerEntryId: LedgerEntryId;
      category: LedgerCategory;
      amount: number;
      date: GameDate;
    };
    /** A promotion changed one of its spending policies (published by ECO1-04). */
    'finance.policyChanged': {
      promotionId: PromotionId;
      area: PolicyArea;
      from: number;
      to: number;
    };
  }
}

export {};
