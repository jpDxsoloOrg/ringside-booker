/**
 * Plain words for the outcome codes talks close with (ECO5-04/05), shared by the Offers list, the
 * Next Day summary and the "Offer answered" stop.
 *
 * Design: docs/design/negotiation.md#review.
 */

import { REFUSES_RENEWAL_CODE } from './asking';
import { LAPSED_OUTCOME, LOST_TO_OTHER_OFFER_OUTCOME, PROMOTION_CLOSED_OUTCOME } from './close';
import { EXCLUSIVE_ELSEWHERE_REASON_CODE, UNAVAILABLE_REASON_CODE } from './eligibility';
import { CONTRACT_ENDED_OUTCOME } from './endedTalks';
import { COOLING_OFF_CODE } from './evaluate';
import { TALKS_ENDED_OUTCOME, WITHDRAWN_OUTCOME } from './submit';
import { REFUSES_ROLE_CODE } from './validate';

/** Plain words for the outcome codes the negotiation system closes talks with. */
export const OUTCOME_MESSAGES: Readonly<Record<string, string>> = {
  [WITHDRAWN_OUTCOME]: 'You withdrew the offer',
  [TALKS_ENDED_OUTCOME]: 'You ended the talks',
  signed: 'Signed',
  signedElsewhere: 'Signed elsewhere',
  walkedAway: 'Walked away from the talks',
  declined: 'Turned the offer down',
  // ECO5-05: how the worker's side closes talks.
  [LAPSED_OUTCOME]: 'They stopped waiting for your answer',
  [LOST_TO_OTHER_OFFER_OUTCOME]: 'Signed with another promotion instead',
  [CONTRACT_ENDED_OUTCOME]: 'Their contract ran out first: make a new offer',
  [PROMOTION_CLOSED_OUTCOME]: 'The promotion closed',
  [REFUSES_RENEWAL_CODE]: "Won't renew while unhappy here",
  [UNAVAILABLE_REASON_CODE]: "Can't sign a contract now",
  [EXCLUSIVE_ELSEWHERE_REASON_CODE]: 'Tied to an exclusive contract elsewhere',
  [COOLING_OFF_CODE]: 'Still cooling off after walking away from you',
  [REFUSES_ROLE_CODE]: "Won't take that role",
};
