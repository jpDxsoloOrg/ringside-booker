/**
 * The booking system's domain events.
 *
 * The booking commands (EVT2-02) publish `card.changed` once for every command that changes a
 * card. The card writer itself publishes nothing: the rival booker (AIP4) writes cards from its own
 * phase and announces them its own way. There is no lock (EVT2-09), so no `card.locked`: a feature
 * that must act just before a show runs registers a hook with the shows system
 * (`registerBeforeShowRuns`). Payloads carry ids and primitives only.
 *
 * Design notes: docs/design/booking.md#commands.
 */

import type { BrandId, EventInstanceId, PromotionId, SegmentId } from '../../core/ids';

/** What a `card.changed` did to the card. */
export const CARD_CHANGES = ['added', 'updated', 'removed', 'moved', 'result', 'cleared'] as const;
export type CardChange = (typeof CARD_CHANGES)[number];

declare module '../../core/events/types' {
  interface DomainEventMap {
    /**
     * A booking command changed a show's card. `segmentId` is the segment it changed (for a move,
     * the one that was moved), or null when the whole card was cleared.
     */
    'card.changed': {
      eventInstanceId: EventInstanceId;
      promotionId: PromotionId;
      brandId: BrandId | null;
      segmentId: SegmentId | null;
      change: CardChange;
    };
  }
}
