/**
 * Closing talks from the worker's side (ECO5-05): they walked away, turned the offer down, let
 * the counter-offer lapse, signed elsewhere or signed with you. One place writes the closed row,
 * moves a signing's `offered` employment off `offered` in the same step (the
 * `negotiations.signingEmploymentIsOffered` invariant) and publishes `negotiation.closed`.
 *
 * A close the day ran for a player's promotion is marked `answerStopsSkip` (ECO5-10), so a skip
 * stops with "Offer answered" until the player opens those talks.
 *
 * Design: docs/design/negotiation.md#review.
 */

import type { GameDate } from '../../core/date';
import { InvalidArgumentError } from '../../core/errors';
import type { PromotionId } from '../../core/ids';
import type { PhaseContext } from '../../core/pipeline/context';
import { canTransition } from '../../model/entities/employment';
import {
  isOpenNegotiationStatus,
  type Negotiation,
  type NegotiationStatus,
} from '../../model/entities/negotiation';
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
  /**
   * True when the player saw the close happen (they accepted the counter-offer themselves), so it
   * does not stop a skip as "Offer answered". Left out: a close the day ran.
   */
  readonly seenByPlayer?: boolean;
}

/**
 * Whether these talks' close stops a skip as "Offer answered" (ECO5-10): a promotion a human runs,
 * a close they did not watch happen, and `contracts.answer.stopSkip` on.
 */
function answerStopsSkip(
  ctx: PhaseContext,
  negotiation: DeepReadonly<Negotiation>,
  close: CloseTalks,
): boolean {
  if (close.seenByPlayer === true) {
    return false;
  }
  const promotion = ctx.read.tables.promotions.get(negotiation.promotionId);
  return (
    promotion?.controller.kind === 'human' &&
    promotion.status !== 'closed' &&
    ctx.tunables.get('contracts.answer.stopSkip')
  );
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
    answerStopsSkip: answerStopsSkip(ctx, negotiation, close),
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

/**
 * After `winner` signed, every other open negotiation for the same worker closes as `declined`
 * with outcome `lostToOtherOffer`, naming the winner but never the amount. `reviewTraceIdOf` gives
 * the review trace id of talks that were compared with the winner.
 */
export function closeTalksLostTo(
  ctx: PhaseContext,
  winner: DeepReadonly<Negotiation>,
  reviewTraceIdOf: (negotiation: DeepReadonly<Negotiation>) => string | null = () => null,
): void {
  for (const negotiation of ctx.read.tables.negotiations.lookup('byPerson', winner.personId)) {
    if (negotiation.id === winner.id || !isOpenNegotiationStatus(negotiation.status)) {
      continue;
    }
    const reviewTraceId = reviewTraceIdOf(negotiation);
    closeTalks(ctx, negotiation, {
      status: 'declined',
      outcomeCode: LOST_TO_OTHER_OFFER_OUTCOME,
      otherPromotionId: winner.promotionId,
      ...(reviewTraceId === null ? {} : { reviewTraceId }),
    });
  }
}
