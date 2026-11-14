/**
 * The reaction step of `contracts.reviewOffers` (ECO5-05): every offer submitted since the last
 * run gets the worker's answer, weighed by ECO5-03's `evaluateOffer` against the ask as it stands
 * today.
 *
 * - `accept`: the offer waits for the review day (`reviewOn` = today +
 *   `contracts.review.delayDays`), so a rival's offer can still beat it.
 * - `counter`: the worker's counter-offer (`counterTermsFor`, one roll on `contracts.counter`),
 *   open until `contracts.counter.expiryDays` from today.
 * - `reject`: costs `contracts.patience.rejectCost` and answers with their full ask ("Not even
 *   close: here's what it takes").
 * - `walkAway`: talks close and the worker will not talk to this promotion again before
 *   `contracts.walkAway.cooldownDays` from today.
 * - `refuse`: talks close as `declined`, with the refusal's code as the outcome.
 *
 * Each reaction is stored at `contracts.reaction` / `<negotiationId>:<round>` (a summary for
 * computer promotions) and named in `reactionTraceId`. Nothing here changes morale.
 *
 * Design: docs/design/negotiation.md#reaction and #review.
 */

import { addDays } from '../../core/date';
import type { PhaseContext } from '../../core/pipeline/context';
import { startDecision } from '../../core/trace/decision';
import type { TraceNode } from '../../core/trace/types';
import { PUSH_LEVELS, type ContractTerms } from '../../model/entities/employment';
import type { Negotiation, NegotiationRound, Reaction } from '../../model/entities/negotiation';
import type { DeepReadonly } from '../../model/world';
import type { EngineTunables } from '../tunables';
import type { AskingTerms } from './asking';
import { closeTalks, WALKED_AWAY_OUTCOME } from './close';
import { askedMoney, counterTermsFor, perkOfTerm } from './counter';
import { evaluateOffer, type OfferEvaluation } from './evaluate';
import { COUNTER_DOC_REF } from './formulas/shared';
import type { Offer } from './offer';
import { REFUSES_ROLE_CODE } from './validate';
import { COUNTER_STREAM } from './streams';
import { cappedHistory, copyOffer } from './submit';
import { counterTraceRef, reactionTraceRef, roundTraceId } from './traceKinds';

/** The counter-offer line of a rejection. */
export const FULL_ASK_COUNTER_REASON = "Not even close: here's what it takes";

/**
 * The counter-offer a rejection comes with: the offer with their full asking money, every perk
 * they ask for, the push they expect and (when far off) the length they prefer. Nothing is rolled.
 */
export function fullAskCounter(
  offer: Offer,
  ask: AskingTerms,
  tunables: EngineTunables,
): { offer: Offer; trace: TraceNode } {
  const decision = startDecision<'counter'>('Their counter-offer', { docRef: COUNTER_DOC_REF });
  const asked = askedMoney(ask);
  const terms: ContractTerms = {
    ...offer.terms,
    shares: { ...offer.terms.shares },
    perks: { ...offer.terms.perks },
    monthlyWage:
      offer.terms.monthlyWage >= asked.monthlyWage ? offer.terms.monthlyWage : asked.monthlyWage,
    perAppearanceFee:
      offer.terms.perAppearanceFee >= asked.perAppearanceFee
        ? offer.terms.perAppearanceFee
        : asked.perAppearanceFee,
    signingBonus:
      offer.terms.signingBonus >= asked.signingBonus
        ? offer.terms.signingBonus
        : asked.signingBonus,
  };
  decision.include('Monthly wage asked', ask.monthlyWage);
  decision.include('Fee asked per appearance', ask.perAppearanceFee);
  decision.include('Signing bonus asked', ask.signingBonus);
  for (const perk of ask.perks) {
    const flag = perkOfTerm(perk.term);
    if (flag !== null) {
      decision.rule(`Wants ${perk.label}: ${perk.reason}`, !terms.perks[flag]);
      terms.perks[flag] = true;
    }
  }
  let push = offer.push;
  const expected = ask.expectedPush.value;
  if (expected !== 'none' && PUSH_LEVELS.indexOf(offer.push) > PUSH_LEVELS.indexOf(expected)) {
    push = expected;
  }
  let lengthMonths = offer.lengthMonths;
  const preferred = ask.preferredLengthMonths.value;
  const tolerance = decision.tunable(tunables, 'contracts.counter.lengthTolerance');
  if (Math.abs(offer.lengthMonths - preferred) > tolerance) {
    lengthMonths = preferred;
  }
  const traced = decision.choose('counter', FULL_ASK_COUNTER_REASON);
  return {
    offer: { ...offer, terms, push, lengthMonths, extra: { ...offer.extra } },
    trace: traced.trace,
  };
}

/** The history with the worker's reaction written on the promotion's offer of `round`. */
function historyWithReaction(
  negotiation: DeepReadonly<Negotiation>,
  reaction: Reaction,
  extra: NegotiationRound | null,
): NegotiationRound[] {
  const rows = negotiation.history.map((entry) => ({
    ...entry,
    offer: copyOffer(entry.offer),
  }));
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const entry = rows[index];
    if (entry?.by === 'promotion' && entry.round === negotiation.round) {
      rows[index] = { ...entry, reaction };
      break;
    }
  }
  return cappedHistory(extra === null ? rows : [...rows, extra]);
}

function isHuman(ctx: PhaseContext, negotiation: DeepReadonly<Negotiation>): boolean {
  return ctx.read.tables.promotions.get(negotiation.promotionId)?.controller.kind === 'human';
}

/** Puts a counter-offer on the table (a counter, or the full ask after a rejection). */
function putCounter(
  ctx: PhaseContext,
  negotiation: DeepReadonly<Negotiation>,
  evaluation: OfferEvaluation,
  counter: { offer: Offer; trace: TraceNode },
  reaction: Reaction,
): void {
  const human = isHuman(ctx, negotiation);
  ctx.recordTrace(
    counterTraceRef(negotiation.id, negotiation.round),
    ctx.date,
    {
      value: 'counter',
      trace: counter.trace,
    },
    { summaryOnly: !human },
  );
  ctx.tx.update('negotiations', negotiation.id, {
    status: 'countered',
    patience: evaluation.patienceLeft,
    lastCounter: counter.offer,
    counterExpiresOn: addDays(ctx.date, ctx.tunables.get('contracts.counter.expiryDays')),
    counterStopsSkip: human && ctx.tunables.get('contracts.counter.stopSkip'),
    reviewOn: null,
    history: historyWithReaction(negotiation, reaction, {
      round: negotiation.round,
      date: ctx.date,
      by: 'worker',
      offer: counter.offer,
      reaction: null,
    }),
    reactionTraceId: roundTraceId(negotiation.id, negotiation.round),
  });
  ctx.publish('negotiation.countered', {
    negotiationId: negotiation.id,
    personId: negotiation.personId,
    promotionId: negotiation.promotionId,
    round: negotiation.round,
  });
}

/** The worker reacts to one submitted offer. */
export function reactToOffer(ctx: PhaseContext, negotiation: DeepReadonly<Negotiation>): Reaction {
  const offer = copyOffer(negotiation.offer);
  const evaluation = evaluateOffer(ctx.read, ctx.tunables, {
    promotionId: negotiation.promotionId,
    personId: negotiation.personId,
    offer,
    negotiation,
    date: ctx.date,
  });
  const reaction = evaluation.reaction.value;
  ctx.recordTrace(
    reactionTraceRef(negotiation.id, negotiation.round),
    ctx.date,
    evaluation.reaction,
    { summaryOnly: !isHuman(ctx, negotiation) },
  );
  const reactionTraceId = roundTraceId(negotiation.id, negotiation.round);
  switch (reaction) {
    case 'accept':
      ctx.tx.update('negotiations', negotiation.id, {
        status: 'awaitingReview',
        patience: evaluation.patienceLeft,
        reviewOn: addDays(ctx.date, ctx.tunables.get('contracts.review.delayDays')),
        history: historyWithReaction(negotiation, reaction, null),
        reactionTraceId,
      });
      break;
    case 'counter':
      putCounter(
        ctx,
        negotiation,
        evaluation,
        counterTermsFor(
          offer,
          evaluation.ask,
          negotiation.round,
          ctx.tunables,
          ctx.rng(COUNTER_STREAM),
        ),
        reaction,
      );
      break;
    case 'reject':
      putCounter(
        ctx,
        negotiation,
        evaluation,
        fullAskCounter(offer, evaluation.ask, ctx.tunables),
        reaction,
      );
      break;
    case 'walkAway': {
      const cooldownUntil = addDays(ctx.date, ctx.tunables.get('contracts.walkAway.cooldownDays'));
      ctx.tx.update('negotiations', negotiation.id, {
        patience: 0,
        history: historyWithReaction(negotiation, reaction, null),
        reactionTraceId,
      });
      closeTalks(ctx, ctx.read.tables.negotiations.require(negotiation.id), {
        status: 'walkedAway',
        outcomeCode: WALKED_AWAY_OUTCOME,
        cooldownUntil,
      });
      ctx.publish('negotiation.walkedAway', {
        negotiationId: negotiation.id,
        personId: negotiation.personId,
        promotionId: negotiation.promotionId,
        cooldownUntil,
      });
      break;
    }
    case 'refuse':
      ctx.tx.update('negotiations', negotiation.id, {
        patience: 0,
        history: historyWithReaction(negotiation, reaction, null),
        reactionTraceId,
      });
      closeTalks(ctx, ctx.read.tables.negotiations.require(negotiation.id), {
        status: 'declined',
        outcomeCode: evaluation.refusal?.code ?? REFUSES_ROLE_CODE,
      });
      break;
  }
  return reaction;
}
