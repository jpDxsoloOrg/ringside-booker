/**
 * The card flow system's trace kinds (EVT4-02).
 *
 * The production ceiling is part of each show's score trace (`shows.showScore`), so it needs no
 * kind of its own. The bonus-slot decision of a show is stored under `production.bonusSlot` with
 * the show's id. Design: docs/design/card-flow.md#bonus-slot.
 */

import type { EventInstanceId } from '../../core/ids';
import type { TraceRef } from '../../core/trace/store';

/** A show's bonus-slot decision, recorded when it is scheduled or its slots are refreshed. */
export const BONUS_SLOT_TRACE_KIND = 'production.bonusSlot';

/** Where a show's bonus-slot decision is stored. */
export function bonusSlotTraceRef(eventInstanceId: EventInstanceId): TraceRef {
  return { kind: BONUS_SLOT_TRACE_KIND, id: eventInstanceId };
}
