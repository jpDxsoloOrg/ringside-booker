/**
 * Talks about a contract that just ended (ECO5-05). When an employment ends for any reason (it
 * ran out, it was released, the worker quit or walked out, an offer was withdrawn), every open
 * negotiation that points at it closes in the same step as `declined` with outcome
 * `contractEnded` ("Their contract ran out first: make a new offer"). Without this an open renewal
 * would point at an ended contract, which the `negotiations.renewalEmploymentIsLive` invariant
 * refuses (a save in that state would not load).
 *
 * `endEmployment` (ECO4) calls it. It reads and writes only the negotiations table, so the
 * contracts system can call it without importing the rest of the negotiation system.
 *
 * Design: docs/design/negotiation.md#renewals.
 */

import type { EmploymentId } from '../../core/ids';
import { isOpenNegotiationStatus } from '../../model/entities/negotiation';
import type { DoorContext } from '../workers/doors';

/** Outcome code of talks whose contract ended before the worker signed. */
export const CONTRACT_ENDED_OUTCOME = 'contractEnded';

/** Closes every open negotiation that points at `employmentId`, which has just ended. */
export function closeTalksOnEndedContract(ctx: DoorContext, employmentId: EmploymentId): void {
  for (const negotiation of ctx.read.tables.negotiations.lookup('byEmployment', employmentId)) {
    if (!isOpenNegotiationStatus(negotiation.status)) {
      continue;
    }
    ctx.tx.update('negotiations', negotiation.id, {
      status: 'declined',
      closedOn: ctx.date,
      lastCounter: null,
      counterExpiresOn: null,
      counterStopsSkip: false,
      reviewOn: null,
      outcome: { code: CONTRACT_ENDED_OUTCOME, otherPromotionId: null },
    });
    ctx.publish('negotiation.closed', {
      negotiationId: negotiation.id,
      personId: negotiation.personId,
      promotionId: negotiation.promotionId,
      status: 'declined',
      outcomeCode: CONTRACT_ENDED_OUTCOME,
    });
  }
}
