/**
 * The negotiation system's day phase, `contracts.reviewOffers` (ECO5-05). Daily, in the
 * `contracts` group at order 5: before ECO4's `contracts.lifecycle` (10), so a deal signed today
 * that starts today is active before the lifecycle and the shows run (the signing starts it
 * itself through `startContract`, so the order is a guarantee, not a requirement).
 *
 * In order, each list in id order from the `byStatus` index:
 *
 * 1. **Reactions** (`reactions.ts`): every `submitted` offer with `submittedOn` on or before today.
 * 2. **Computer counters** (`counterResponders.ts`): every counter-offer waiting for a computer
 *    promotion is answered, so talks never stall.
 * 3. **Lapses**: a counter-offer nobody answered by `counterExpiresOn` closes as `lapsed` ("They
 *    stopped waiting for your answer"; no cooldown) and a signing's offer is withdrawn.
 * 4. **Reviews** (`review.ts`): every worker whose earliest review day has come signs one offer.
 * 5. **Pruning** (`prune.ts`): closed talks past `contracts.history.closedKeepDays` and their
 *    cooldown are cleared away.
 *
 * Nothing here changes morale (ECO5 never does: the D-09 story shield stays the only place
 * loss-related morale is decided).
 *
 * Design: docs/design/negotiation.md#review and docs/design/day-pipeline.md.
 */

import { compareDates } from '../../core/date';
import type { PhaseContext } from '../../core/pipeline/context';
import { definePhase, type PhaseDefinition } from '../../core/pipeline/phase';
import { compareIds } from '../../model/table';
import { closeTalks, LAPSED_OUTCOME } from './close';
import { answerComputerCounter } from './counterResponders';
import { pruneClosedTalks } from './prune';
import { reactToOffer } from './reactions';
import { reviewDueOffers } from './review';

export const REVIEW_OFFERS_PHASE_ID = 'contracts.reviewOffers';

function byId<T extends { id: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((left, right) => compareIds(left.id, right.id));
}

function reactToSubmitted(ctx: PhaseContext): void {
  for (const negotiation of byId(ctx.read.tables.negotiations.lookup('byStatus', 'submitted'))) {
    if (compareDates(negotiation.submittedOn, ctx.date) <= 0) {
      reactToOffer(ctx, negotiation);
    }
  }
}

function answerComputerCounters(ctx: PhaseContext): void {
  for (const negotiation of byId(ctx.read.tables.negotiations.lookup('byStatus', 'countered'))) {
    const promotion = ctx.read.tables.promotions.get(negotiation.promotionId);
    if (promotion?.controller.kind === 'computer' && promotion.status !== 'closed') {
      answerComputerCounter(ctx, negotiation);
    }
  }
}

function lapseCounters(ctx: PhaseContext): void {
  for (const negotiation of byId(ctx.read.tables.negotiations.lookup('byStatus', 'countered'))) {
    const expires = negotiation.counterExpiresOn;
    if (expires !== null && compareDates(expires, ctx.date) < 0) {
      closeTalks(ctx, negotiation, { status: 'lapsed', outcomeCode: LAPSED_OUTCOME });
    }
  }
}

/** The whole phase. */
export function runReviewOffers(ctx: PhaseContext): void {
  reactToSubmitted(ctx);
  answerComputerCounters(ctx);
  lapseCounters(ctx);
  reviewDueOffers(ctx);
  pruneClosedTalks(ctx);
}

export const reviewOffersPhase: PhaseDefinition = definePhase({
  id: REVIEW_OFFERS_PHASE_ID,
  group: 'contracts',
  order: 5,
  cadence: { kind: 'daily' },
  run: runReviewOffers,
});

export const negotiationPhases: readonly PhaseDefinition[] = [reviewOffersPhase];
