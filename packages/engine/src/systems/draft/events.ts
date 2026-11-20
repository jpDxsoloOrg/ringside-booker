/**
 * The draft's domain events: ids and counts only. There is no event per pick (a big world makes
 * thousands, which would push everything else out of the recent-event log); one event per command
 * says how far the draft got.
 *
 * Design: docs/design/draft.md#commands.
 */

import type { DraftId, PersonId, PromotionId } from '../../core/ids';

declare module '../../core/events/types' {
  interface DomainEventMap {
    /** A draft command made picks: how many, and the next pick number. */
    'draft.advanced': { draftId: DraftId; picks: number; nextPick: number };
    /** Every pick is made: the draft waits for `draft.finish`. */
    'draft.completed': { draftId: DraftId; picks: number };
    /** The draft is closed for good; day 1 may start. */
    'draft.finished': { draftId: DraftId; picks: number; signed: number; released: number };
    /** An unsigned pick went back to the pool. */
    'draft.released': { draftId: DraftId; personId: PersonId; promotionId: PromotionId };
  }
}

export {};
