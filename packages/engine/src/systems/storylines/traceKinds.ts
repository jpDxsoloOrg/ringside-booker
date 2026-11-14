/**
 * The storylines system's trace kinds and the refs its traces are stored under (CRTV3-01).
 *
 * - `storylines.heat`: one current heat trace per storyline. It explains the starting heat, then
 *   the latest cooling step (CRTV3-02), then the latest progress after a segment (CRTV4); each
 *   writer replaces the one before.
 * - `storylines.starter`: why a starter storyline was picked at new game (CRTV3-02).
 * - `storylines.payoff`: reserved for CRTV4's payoff when a storyline ends. CRTV3 only checks
 *   whether one exists, to say the storyline paid off.
 *
 * Every kind is stored under the storyline's id. Design: docs/design/storylines.md.
 */

import type { StorylineId } from '../../core/ids';
import type { TraceRef } from '../../core/trace/store';

export const STORYLINE_HEAT_TRACE_KIND = 'storylines.heat';
export const STORYLINE_STARTER_TRACE_KIND = 'storylines.starter';
export const STORYLINE_PAYOFF_TRACE_KIND = 'storylines.payoff';

/** Every trace kind the storylines features store. */
export const STORYLINE_TRACE_KINDS = [
  STORYLINE_HEAT_TRACE_KIND,
  STORYLINE_STARTER_TRACE_KIND,
  STORYLINE_PAYOFF_TRACE_KIND,
] as const;

/** Where a storyline's current heat trace is stored. */
export function storylineHeatTraceRef(storylineId: StorylineId): TraceRef {
  return { kind: STORYLINE_HEAT_TRACE_KIND, id: storylineId };
}

/** Where the reason a starter storyline was picked is stored. */
export function storylineStarterTraceRef(storylineId: StorylineId): TraceRef {
  return { kind: STORYLINE_STARTER_TRACE_KIND, id: storylineId };
}

/** Where a storyline's payoff trace is stored (written by CRTV4). */
export function storylinePayoffTraceRef(storylineId: StorylineId): TraceRef {
  return { kind: STORYLINE_PAYOFF_TRACE_KIND, id: storylineId };
}
