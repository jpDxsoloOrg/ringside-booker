/**
 * Closing talks from the worker's side (ECO5-05): they walked away, turned the offer down, let
 * the counter-offer lapse, signed elsewhere or signed with you. One place writes the closed row,
 * moves a signing's `offered` employment off `offered` in the same step (the
 * `negotiations.signingEmploymentIsOffered` invariant) and publishes `negotiation.closed`.
 *
 * Design: docs/design/negotiation.md#review.
 */

import type { GameDate } from '../../core/date';
import { InvalidArgumentError } from '../../core/errors';
import type { PromotionId } from '../../core/ids';
import type { PhaseContext } from '../../core/pipeline/context';
import { canTransition } from '../../model/entities/employment';
import type { Negotiation, NegotiationStatus } from '../../model/entities/negotiation';
import type { DeepReadonly } from '../../model/world';

/** Outcome codes the worker's side closes talks with. */
export const SIGNED_OUTCOME = 'signed';
export const LOST_TO_OTHER_OFFER_OUTCOME = 'lostToOtherOffer';
export const WALKED_AWAY_OUTCOME = 'walkedAway';
export const LAPSED_OUTCOME = 'lapsed';
export const PROMOTION_CLOSED_OUTCOME = 'promotionClosed';

/** How a worker-side close leaves the talks. */
export interface CloseTalks {
  readonly status: Extract<NegotiationStatus, 'signed' | 'declined' | 'walkedAway' | 'lapsed'>;
  readonly outcomeCode: string;
  readonly otherPromotionId?: PromotionId | null;
  readonly cooldownUntil?: GameDate | null;
  /** The review trace id, when the review closed them. */
  readonly reviewTraceId?: string | null;
}

/**
 * Closes open talks. A signing's `offered` employment becomes `declined` (the worker said no) or,
 * for a lapsed counter-offer, `withdrawn` (nobody answered); a signed one is moved by the caller.
 */
export function closeTalks(
  ctx: PhaseContext,
  negotiation: DeepReadonly<Negotiation>,
  close: CloseTalks,
): void {
  if (negotiation.kind === 'signing' && close.status !== 'signed') {
    const to = close.status === 'lapsed' ? 'withdrawn' : 'declined';
    const employment = ctx.read.tables.employments.require(negotiation.employmentId);
    if (employment.status === 'offered') {
      if (!canTransition(employment.status, to)) {
        throw new InvalidArgumentError('closeTalks', 'employment.status', employment.status, to);
      }
      ctx.tx.update('employments', employment.id, { status: to, endedOn: ctx.date });
    }
  }
  ctx.tx.update('negotiations', negotiation.id, {
    status: close.status,
    closedOn: ctx.date,
    lastCounter: null,
    counterExpiresOn: null,
    counterStopsSkip: false,
    reviewOn: null,
    outcome: { code: close.outcomeCode, otherPromotionId: close.otherPromotionId ?? null },
    cooldownUntil: close.cooldownUntil ?? negotiation.cooldownUntil,
    ...(close.reviewTraceId === undefined ? {} : { reviewTraceId: close.reviewTraceId }),
  });
  ctx.publish('negotiation.closed', {
    negotiationId: negotiation.id,
    personId: negotiation.personId,
    promotionId: negotiation.promotionId,
    status: close.status,
    outcomeCode: close.outcomeCode,
  });
}
