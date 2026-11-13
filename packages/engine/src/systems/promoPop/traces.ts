/**
 * The promotion popularity system's trace kinds and the refs its traces are stored under.
 *
 * Each show records one trace per region it reached. Shows of human-controlled promotions and of
 * computer-controlled ones use separate kinds: rival shows reach hundreds of regions a week, and
 * `sim.traceRetentionPerKind` counts per kind, so sharing one would push the player's own Why?
 * panels out within days. Design: docs/design/promotion-popularity.md#after-every-show.
 */

import type { EventInstanceId, RegionId } from '../../core/ids';
import type { TraceRef } from '../../core/trace/store';

/** One region's popularity change from a human-controlled promotion's show. */
export const SHOW_CHANGE_TRACE_KIND = 'promoPop.showChange';
/** One region's popularity change from a computer-controlled promotion's show. */
export const RIVAL_SHOW_CHANGE_TRACE_KIND = 'promoPop.rivalShowChange';

/** Every trace kind the promotion popularity system stores. */
export const PROMO_POP_TRACE_KINDS = [
  SHOW_CHANGE_TRACE_KIND,
  RIVAL_SHOW_CHANGE_TRACE_KIND,
] as const;

/** Where one region's change from one show is stored. Id: `${eventInstanceId}/${regionId}`. */
export function showChangeTraceRef(
  eventInstanceId: EventInstanceId,
  regionId: RegionId,
  humanShow: boolean,
): TraceRef {
  return {
    kind: humanShow ? SHOW_CHANGE_TRACE_KIND : RIVAL_SHOW_CHANGE_TRACE_KIND,
    id: `${eventInstanceId}/${regionId}`,
  };
}
