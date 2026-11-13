/**
 * The office system's stored trace: the headline popularity Why? of each promotion (DAY2-02).
 *
 * The kind string lives in core (`POPULARITY_TRACE_KIND`), the way ECO1 keeps `finance.cash`, so
 * `sim.status` can read the trace without importing this system. Recording the same ref again
 * replaces the entry, so a promotion only ever has one. See docs/design/office.md#headline-popularity.
 */

import { POPULARITY_TRACE_KIND } from '../../core/api/builtins';
import type { PromotionId } from '../../core/ids';
import type { TraceRef } from '../../core/trace/store';

export { POPULARITY_TRACE_KIND };

/** The ref of `promotionId`'s headline popularity trace. */
export function popularityTraceRef(promotionId: PromotionId): TraceRef {
  return { kind: POPULARITY_TRACE_KIND, id: promotionId };
}
