/**
 * The broadcast system's trace kinds and the refs its traces are stored under (ECO8-01).
 *
 * Airings of human-controlled and computer-controlled promotions use separate kinds, so a dozen
 * rival shows a week never push the player's airings out of `sim.traceRetentionPerKind`. A deal's
 * health trace keeps only the latest verdict (id = the deal id). See docs/design/broadcast.md.
 */

import type { DealId } from '../../core/ids';
import type { TraceRef } from '../../core/trace/store';
import type { Airing } from '../../model/entities/airing';
import type { Controller } from '../../model/controller';

/** An airing of a human-controlled promotion. Id: the airing id. */
export const AIRING_TRACE_KIND = 'broadcast.airing';
/** An airing of a computer-controlled promotion. Id: the airing id. */
export const RIVAL_AIRING_TRACE_KIND = 'broadcast.rivalAiring';
/** The latest health verdict on a deal. Id: the deal id. */
export const DEAL_HEALTH_TRACE_KIND = 'broadcast.health';

/** Every trace kind the broadcast system stores. */
export const BROADCAST_TRACE_KINDS = [
  AIRING_TRACE_KIND,
  RIVAL_AIRING_TRACE_KIND,
  DEAL_HEALTH_TRACE_KIND,
] as const;

/** True when a person runs the promotion, so its airings get the player's trace kind. */
export function isHumanControlled(promotion: { readonly controller: Controller }): boolean {
  return promotion.controller.kind === 'human';
}

/** Where an airing's Why? trace is stored: its own kind for human-controlled promotions. */
export function airingTraceRef(airing: Pick<Airing, 'id'>, humanControlled: boolean): TraceRef {
  return {
    kind: humanControlled ? AIRING_TRACE_KIND : RIVAL_AIRING_TRACE_KIND,
    id: airing.id,
  };
}

/** Where the latest health verdict on a deal is stored. */
export function dealHealthTraceRef(dealId: DealId): TraceRef {
  return { kind: DEAL_HEALTH_TRACE_KIND, id: dealId };
}
