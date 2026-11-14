/**
 * How a worker reacts to an offer (ECO5-03). The first rule that matches decides:
 *
 * 1. a refusal (an unhappy renewal, talks they will not have) or a role they will not take →
 *    `refuse`;
 * 2. the offer matches their last counter-offer → `accept`;
 * 3. the offer is worth at least `contracts.react.acceptRatio` of their ask → `accept`;
 * 4. at least `contracts.react.counterRatio`, with patience left → `counter`;
 * 5. at least `contracts.react.walkAwayRatio`, with more patience left than
 *    `contracts.patience.rejectCost` → `reject`;
 * 6. otherwise → `walkAway` ("Out of patience" or "Far below their ask").
 *
 * The worth of the offer against the ask is a traced score, so the Why? shows both contract
 * values and the share. Nothing is rolled: the same offer always gets the same reaction.
 *
 * Design: docs/design/negotiation.md#reaction.
 */

import type { Reason } from '../../../core/api/result';
import { startCalc } from '../../../core/trace/calc';
import { constantOf } from '../../../core/trace/helpers';
import { startDecision } from '../../../core/trace/decision';
import type { Traced } from '../../../core/trace/types';
import type { Reaction } from '../../../model/entities/negotiation';
import type { EngineTunables } from '../../tunables';
import { percentText, REACTION_DOC_REF } from './shared';

export interface OfferReactionInputs {
  /** The offer's contract value, cents a month. */
  readonly offerValue: Traced<number>;
  /** The contract value of the worker's own ask, cents a month. */
  readonly askValue: Traced<number>;
  /** Patience left before this offer. */
  readonly patience: number;
  /** Why the worker will not sign with you at all, or null. */
  readonly refusal: Reason | null;
  /** Why the worker will not take the offered role, or null. */
  readonly roleMismatch: string | null;
  /** True when the offer matches (or betters) the worker's last counter-offer. */
  readonly matchesLastCounter: boolean;
}

export const MATCHES_COUNTER_REASON = 'Matches their counter-offer';
export const OUT_OF_PATIENCE_REASON = 'Out of patience';
export const FAR_BELOW_REASON = 'Far below their ask';

/** The offer's worth as a share of the ask's, traced. */
export function offerRatio(offerValue: Traced<number>, askValue: Traced<number>): Traced<number> {
  if (askValue.value <= 0) {
    return constantOf('Offer against their ask', 1, 'They ask for nothing, so any offer is enough');
  }
  return startCalc('Offer against their ask', offerValue, {
    unit: 'ratio',
    docRef: REACTION_DOC_REF,
  })
    .divide('Value of their ask', askValue)
    .done();
}

/** The worker's reaction to one offer, every rule traced. */
export function offerReaction(
  inputs: OfferReactionInputs,
  deps: { tunables: EngineTunables },
): Traced<Reaction> {
  const { tunables } = deps;
  const decision = startDecision<Reaction>('How they react', { docRef: REACTION_DOC_REF });

  decision.rule(inputs.refusal?.message ?? 'Willing to talk', inputs.refusal === null);
  if (inputs.refusal !== null) {
    return decision.choose('refuse', inputs.refusal.message);
  }
  decision.rule(inputs.roleMismatch ?? 'Will take the role', inputs.roleMismatch === null);
  if (inputs.roleMismatch !== null) {
    return decision.choose('refuse', inputs.roleMismatch);
  }
  if (inputs.matchesLastCounter) {
    decision.rule(MATCHES_COUNTER_REASON, true);
    return decision.choose('accept', MATCHES_COUNTER_REASON);
  }

  const ratio = offerRatio(inputs.offerValue, inputs.askValue);
  decision.include('Offer against their ask', ratio);
  const share = percentText(ratio.value);

  const acceptAt = decision.tunable(tunables, 'contracts.react.acceptRatio');
  const accepts = ratio.value >= acceptAt;
  decision.rule(`${share} of their ask is at least ${percentText(acceptAt)}`, accepts);
  if (accepts) {
    decision.consider('accept', ratio.value, 'Close enough to their ask');
    return decision.choose('accept', `Worth ${share} of their ask`);
  }

  const counterAt = decision.tunable(tunables, 'contracts.react.counterRatio');
  const closeEnough = ratio.value >= counterAt;
  decision.rule(`${share} of their ask is at least ${percentText(counterAt)}`, closeEnough);
  decision.rule(`Patience left: ${String(inputs.patience)}`, inputs.patience > 0);
  if (closeEnough && inputs.patience > 0) {
    decision.consider('counter', ratio.value, 'Close enough to talk');
    return decision.choose('counter', `Worth ${share} of their ask: they will counter`);
  }

  const walkAt = decision.tunable(tunables, 'contracts.react.walkAwayRatio');
  const rejectCost = decision.tunable(tunables, 'contracts.patience.rejectCost');
  const notFarBelow = ratio.value >= walkAt;
  decision.rule(`${share} of their ask is at least ${percentText(walkAt)}`, notFarBelow);
  const patientEnough = inputs.patience > rejectCost;
  decision.rule(
    `Patience left (${String(inputs.patience)}) is more than a rejection costs (${String(rejectCost)})`,
    patientEnough,
  );
  if (notFarBelow && patientEnough) {
    decision.consider('reject', ratio.value, 'Too low, but they keep talking');
    return decision.choose('reject', `Worth only ${share} of their ask`);
  }
  const because = notFarBelow ? OUT_OF_PATIENCE_REASON : FAR_BELOW_REASON;
  decision.consider('walkAway', ratio.value, because);
  return decision.choose('walkAway', because);
}
