/**
 * The trace kinds the negotiation system stores under (ECO5-01). They are separate kinds so the
 * busy reaction kind does not push the review traces out of `sim.traceRetentionPerKind`.
 *
 * - `contracts.ask`, id = `<negotiationId>:<round>`: the worker's asking terms when an offer is
 *   submitted (ECO5-02).
 * - `contracts.reaction`, id = `<negotiationId>:<round>`: how the worker reacted to an offer.
 * - `contracts.counter`, id = `<negotiationId>:<round>`: how the counter-offer was built.
 * - `contracts.review`, id = `<negotiationId>:review`: the decision on the review day.
 * - `contracts.signingBonus`, id = `<negotiationId>:review`: the signing bonus paid on signing.
 */

import type { NegotiationId } from '../../core/ids';
import type { TraceRef } from '../../core/trace/store';

export const NEGOTIATION_TRACE_KINDS = {
  ask: 'contracts.ask',
  reaction: 'contracts.reaction',
  counter: 'contracts.counter',
  review: 'contracts.review',
  signingBonus: 'contracts.signingBonus',
} as const;

export type NegotiationTraceKind =
  (typeof NEGOTIATION_TRACE_KINDS)[keyof typeof NEGOTIATION_TRACE_KINDS];

/** The trace id of one round of a negotiation. */
export function roundTraceId(negotiationId: NegotiationId, round: number): string {
  return `${negotiationId}:${String(round)}`;
}

/** The trace id of a negotiation's review. */
export function reviewTraceId(negotiationId: NegotiationId): string {
  return `${negotiationId}:review`;
}

/** Where the worker's asking terms for a round are stored. */
export function askTraceRef(negotiationId: NegotiationId, round: number): TraceRef {
  return { kind: NEGOTIATION_TRACE_KINDS.ask, id: roundTraceId(negotiationId, round) };
}

/** Where the worker's reaction to a round's offer is stored. */
export function reactionTraceRef(negotiationId: NegotiationId, round: number): TraceRef {
  return { kind: NEGOTIATION_TRACE_KINDS.reaction, id: roundTraceId(negotiationId, round) };
}

/** Where a round's counter-offer is explained. */
export function counterTraceRef(negotiationId: NegotiationId, round: number): TraceRef {
  return { kind: NEGOTIATION_TRACE_KINDS.counter, id: roundTraceId(negotiationId, round) };
}

/** Where the review decision is stored. */
export function reviewTraceRef(negotiationId: NegotiationId): TraceRef {
  return { kind: NEGOTIATION_TRACE_KINDS.review, id: reviewTraceId(negotiationId) };
}

/** Where the signing bonus paid on signing is explained. */
export function signingBonusTraceRef(negotiationId: NegotiationId): TraceRef {
  return { kind: NEGOTIATION_TRACE_KINDS.signingBonus, id: reviewTraceId(negotiationId) };
}
