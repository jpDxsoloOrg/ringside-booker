/**
 * Who may see a negotiation trace (ECO5-05). Talks are private to the promotion having them, and
 * a review decision compares every bidder's offer, so:
 *
 * - a review decision (`contracts.review`) is returned by `trace.get` only to a viewer who runs the
 *   negotiation's promotion (or the omniscient viewer); the other kinds keep the usual rule (a
 *   computer promotion's traces are stored as summaries only);
 * - and it is redacted for that viewer: other promotions' score nodes become "Another
 *   offer was compared" and their entries leave the list of options weighed. Names stay (the
 *   outcome names the winner anyway); their values and amounts never leave the engine.
 *
 * The full decision is stored; redaction happens on the way out (`trace.get` here, and the offers
 * queries, which return the redacted review inline).
 *
 * Design: docs/design/negotiation.md#review.
 */

import { viewerPromotionIds } from '../../core/api/controller';
import type { QueryContext } from '../../core/api/query';
import { registerTraceReadGuard } from '../../core/api/traceGuards';
import { isId, type NegotiationId, type PromotionId } from '../../core/ids';
import { isFullTrace, type StoredTraceEntry } from '../../core/trace/store';
import type { ConsideredOption, TraceNode } from '../../core/trace/types';
import { NEGOTIATION_TRACE_KINDS } from './traceKinds';

export const ANOTHER_OFFER_NOTE = 'Another offer was compared';

/** The promotion whose offer a review score node weighs, or null for any other node. */
function scoredPromotion(node: TraceNode): string | null {
  if (node.kind !== 'formula') {
    return null;
  }
  const [first] = node.children;
  return first?.kind === 'input' && first.ref?.kind === 'promotion' ? first.ref.id : null;
}

/**
 * The review decision as a viewer running `viewerPromotionIds` may see it: other promotions'
 * score nodes replaced by a note, their options left out of the options weighed, and a winning
 * offer of theirs named by its promotion instead of its id. Score nodes and options pair up in
 * order (the decision records each option's score as it weighs it, with the promotion's name as
 * the option's reason).
 */
export function redactReviewTrace(
  node: TraceNode,
  viewerPromotionIds: readonly PromotionId[],
): TraceNode {
  const own = new Set<string>(viewerPromotionIds);
  const redact = (current: TraceNode): TraceNode => {
    const children = current.children;
    if (children === undefined) {
      return current;
    }
    const hidden: boolean[] = [];
    const nextChildren = children.map((child): TraceNode => {
      const promotionId = scoredPromotion(child);
      if (promotionId === null) {
        return redact(child);
      }
      const mine = own.has(promotionId);
      hidden.push(!mine);
      return mine ? child : { kind: 'note', label: ANOTHER_OFFER_NOTE, value: null };
    });
    if (current.kind !== 'decision') {
      return { ...current, children: nextChildren };
    }
    const considered: ConsideredOption[] = current.considered.filter(
      (_option, index) => hidden[index] !== true,
    );
    // Another promotion won: name it (the option's reason) instead of its private talks' id.
    const chosenIndex = current.considered.findIndex((option) => option.option === current.chosen);
    const chosen =
      chosenIndex >= 0 && hidden[chosenIndex] === true
        ? (current.considered[chosenIndex]?.reason ?? ANOTHER_OFFER_NOTE)
        : current.chosen;
    return { ...current, considered, chosen, value: chosen, children: nextChildren };
  };
  return redact(node);
}

/** The negotiation a negotiation trace id belongs to: `<negotiationId>:…`. */
export function negotiationOfTraceId(id: string): NegotiationId | null {
  const [negotiationId] = id.split(':');
  return isId('negotiation', negotiationId) ? negotiationId : null;
}

/** What `ctx.viewer` may see of a stored negotiation trace. */
export function guardNegotiationTrace(
  ctx: QueryContext,
  entry: StoredTraceEntry,
): StoredTraceEntry | null {
  if (ctx.viewer.kind === 'omniscient') {
    return entry;
  }
  const negotiationId = negotiationOfTraceId(entry.ref.id);
  const negotiation =
    negotiationId === null ? undefined : ctx.read.tables.negotiations.get(negotiationId);
  const viewerIds = viewerPromotionIds(ctx.read, ctx.viewer);
  if (negotiation === undefined || !viewerIds.includes(negotiation.promotionId)) {
    return null;
  }
  if (!isFullTrace(entry)) {
    return { ...entry, topContributors: [] };
  }
  const trace = redactReviewTrace(entry.trace, viewerIds);
  return { ...entry, trace, value: trace.value };
}

registerTraceReadGuard(NEGOTIATION_TRACE_KINDS.review, guardNegotiationTrace);
