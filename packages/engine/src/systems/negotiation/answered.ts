/**
 * The "Offer answered" stop (ECO5-10): a skip stops when a worker answered one of a player's
 * offers while the days ran, so a signing, a refusal or a walk-away never goes unnoticed.
 *
 * - **What stops.** Talks of a promotion a human runs that the day closed from the worker's side:
 *   signed, turned down (including "signed with another promotion instead" and a refusal) or
 *   walked away. A counter-offer the player let lapse does not: it was theirs to answer. `closeTalks` marks them `answerStopsSkip` when
 *   `contracts.answer.stopSkip` is on (gates cannot read tunables). A counter-offer has its own
 *   stop (`contracts.counterWaiting`), and talks the player closed or signed themselves (withdrawn,
 *   ended, an accepted counter-offer) never stop anything: they saw it happen.
 * - **The reason** is one plain line: "Rhea Cortez signed with you", "Kai Moreno turned down your
 *   offer: won't take that role", "Kai Moreno signed with Crown Pro instead". Never an amount.
 * - **Clearing it.** `contracts.markOffersSeen { negotiationIds }` clears the flag; the web sends
 *   it when the talks open (Contracts › Offers, where the day bar's button goes) or when the
 *   worker's profile opens. Unknown or pruned ids are passed over, so the screen can never be left
 *   with a stop it cannot clear. Pruning (`contracts.history.closedKeepDays`) removes the row and
 *   the stop with it.
 *
 * Design: docs/design/negotiation.md#offer-answered-stop.
 */

import { z } from 'zod';
import { controlsPromotion } from '../../core/api/controller';
import { defineCommand } from '../../core/api/command';
import { compareDates } from '../../core/date';
import type { NegotiationId } from '../../core/ids';
import type { GateHit, GateSpec } from '../../core/pipeline/gates';
import type { Negotiation } from '../../model/entities/negotiation';
import { zId } from '../../model/primitives';
import { compareIds } from '../../model/table';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';
import { LOST_TO_OTHER_OFFER_OUTCOME } from './close';
import { OUTCOME_MESSAGES } from './offersQueries';

export const OFFER_ANSWERED_GATE_ID = 'contracts.offerAnswered';
/** The day bar's route hint for the stop: the talks on Contracts › Offers. */
export const OFFER_ANSWERED_ACTION_HINT = 'offerAnswered';
/** The most negotiation ids one `contracts.markOffersSeen` takes. */
export const MARK_OFFERS_SEEN_MAX = 200;

declare module '../../core/api/maps' {
  interface CommandMap {
    'contracts.markOffersSeen': {
      args: { negotiationIds: NegotiationId[] };
      result: { cleared: number };
    };
  }
}

/** The player's answered talks that stop a skip, the earliest answer first. */
export function answeredOffers(read: GameWorldView): DeepReadonly<Negotiation>[] {
  const answered: DeepReadonly<Negotiation>[] = [];
  for (const promotion of read.tables.promotions.values()) {
    if (promotion.controller.kind !== 'human' || promotion.status === 'closed') {
      continue;
    }
    for (const negotiation of read.tables.negotiations.lookup('byPromotion', promotion.id)) {
      if (negotiation.answerStopsSkip) {
        answered.push(negotiation);
      }
    }
  }
  return answered.sort(
    (left, right) =>
      compareDates(left.closedOn ?? left.submittedOn, right.closedOn ?? right.submittedOn) ||
      compareIds(left.id, right.id),
  );
}

function lowerFirst(text: string): string {
  return text.length === 0 ? text : `${text.charAt(0).toLowerCase()}${text.slice(1)}`;
}

/** The stop's reason for one answer, in plain words and without an amount. */
export function offerAnsweredReason(
  read: GameWorldView,
  negotiation: DeepReadonly<Negotiation>,
): string {
  const name =
    read.tables.employments.get(negotiation.employmentId)?.ringName ??
    read.tables.people.get(negotiation.personId)?.defaultRingName ??
    'A worker';
  const renewal = negotiation.kind === 'renewal';
  switch (negotiation.status) {
    case 'signed':
      return renewal ? `${name} signed your new contract` : `${name} signed with you`;
    case 'walkedAway':
      return `${name} walked away from your offer`;
    case 'lapsed':
      return `${name} stopped waiting for your answer`;
    case 'declined': {
      const code = negotiation.outcome?.code;
      if (code === LOST_TO_OTHER_OFFER_OUTCOME) {
        const other =
          negotiation.outcome?.otherPromotionId === null ||
          negotiation.outcome?.otherPromotionId === undefined
            ? undefined
            : read.tables.promotions.get(negotiation.outcome.otherPromotionId)?.name;
        return other === undefined
          ? `${name} signed with another promotion instead`
          : `${name} signed with ${other} instead`;
      }
      const words = code === undefined ? undefined : OUTCOME_MESSAGES[code];
      return words === undefined
        ? `${name} turned down your offer`
        : `${name} turned down your offer: ${lowerFirst(words)}`;
    }
    case 'withdrawn':
    case 'submitted':
    case 'awaitingReview':
    case 'countered':
      return `${name} answered your offer`;
  }
}

export const offerAnsweredGate: GateSpec = {
  id: OFFER_ANSWERED_GATE_ID,
  label: 'Offer answered',
  check: (view): GateHit | null => {
    const [first] = answeredOffers(view);
    if (first === undefined) {
      return null;
    }
    return {
      gateId: OFFER_ANSWERED_GATE_ID,
      reason: offerAnsweredReason(view, first),
      subject: { kind: 'negotiation', id: first.id },
      actionHint: OFFER_ANSWERED_ACTION_HINT,
    };
  },
};

export const markOffersSeenCommand = defineCommand('contracts.markOffersSeen', {
  args: z.strictObject({
    negotiationIds: z.array(zId('negotiation')).max(MARK_OFFERS_SEEN_MAX),
  }),
  // Talks that are gone (pruned) or not yours are passed over rather than refused, so opening
  // a screen can always clear what it shows.
  validate: () => [],
  apply: (ctx, args, issuedBy): { cleared: number } => {
    let cleared = 0;
    for (const negotiationId of [...new Set(args.negotiationIds)].sort(compareIds)) {
      const negotiation = ctx.read.tables.negotiations.get(negotiationId);
      if (
        negotiation === undefined ||
        !negotiation.answerStopsSkip ||
        !controlsPromotion(ctx.read, negotiation.promotionId, issuedBy)
      ) {
        continue;
      }
      ctx.tx.update('negotiations', negotiation.id, { answerStopsSkip: false });
      cleared += 1;
    }
    return { cleared };
  },
});
