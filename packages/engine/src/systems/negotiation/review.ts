/**
 * The review step of `contracts.reviewOffers` (ECO5-05): on a worker's review day they look at
 * every offer they agreed to (`awaitingReview`, from any promotion and controller) and sign one.
 *
 * - An agreed offer stays agreed: the ratio test is not run again (accepting their counter-offer
 *   clears it, so a second test could turn a deal they already said yes to into a counter). An
 *   offer drops out only when the worker can no longer sign it at all: the renewed contract ran
 *   out (`contractEnded`), the promotion closed, or a refusal now applies (they became unavailable,
 *   are tied up elsewhere, won't renew while unhappy, won't take the role).
 * - The rest are scored by their value ÷ the value of what the worker asks of *that* promotion
 *   (the ask differs by reach and prestige), so a smaller promotion can win with a lower wage.
 * - Highest score signs. Scores within `contracts.review.tieEpsilon` of the best are a tie, broken
 *   by a roll on `contracts.review` recorded in the decision.
 * - The decision is stored at `contracts.review` / `<negotiationId>:review` for every offer in the
 *   comparison (full; the queries and `trace.get` hide other promotions' scores, `redact.ts`).
 * - Every other open negotiation for that worker closes as `declined` with outcome
 *   `lostToOtherOffer`, naming the winner but never the amount.
 *
 * Design: docs/design/negotiation.md#review.
 */

import { compareDates, type GameDate } from '../../core/date';
import type { NegotiationId, PersonId } from '../../core/ids';
import type { PhaseContext } from '../../core/pipeline/context';
import { rollPick } from '../../core/rng/rolls';
import { startDecision, type Decision } from '../../core/trace/decision';
import { inputOf } from '../../core/trace/helpers';
import type { TraceNode, Traced } from '../../core/trace/types';
import { isOpenNegotiationStatus, type Negotiation } from '../../model/entities/negotiation';
import { compareIds } from '../../model/table';
import type { DeepReadonly } from '../../model/world';
import { closeTalks, LOST_TO_OTHER_OFFER_OUTCOME, PROMOTION_CLOSED_OUTCOME } from './close';
import { CONTRACT_ENDED_OUTCOME } from './endedTalks';
import { evaluateOffer, meetsCounter } from './evaluate';
import { MATCHES_COUNTER_REASON, offerRatio } from './formulas/offerReaction';
import { signNegotiation } from './sign';
import { REVIEW_STREAM } from './streams';
import { copyOffer } from './submit';
import { reviewTraceId, reviewTraceRef } from './traceKinds';
import { REFUSES_ROLE_CODE } from './validate';

export const REVIEW_DOC_REF = 'negotiation.md#review';
/** The label every offer's score node in the review decision starts with. */
export const SCORE_LABEL_SUFFIX = 'of their ask';

interface Candidate {
  readonly negotiation: DeepReadonly<Negotiation>;
  readonly promotionName: string;
  readonly score: Traced<number>;
}

/** True when the offer on the table is the worker's own counter-offer (or better on money). */
function matchesTheirCounter(negotiation: DeepReadonly<Negotiation>): boolean {
  for (let index = negotiation.history.length - 1; index >= 0; index -= 1) {
    const entry = negotiation.history[index];
    if (entry?.by === 'worker') {
      return meetsCounter(copyOffer(negotiation.offer), entry.offer);
    }
  }
  return false;
}

/**
 * One offer's score node: "Altura: 1.02 of their ask", a formula whose first child names the
 * promotion (with its ref, which is how `redactReviewTrace` tells whose score it is).
 */
function scoreOf(
  negotiation: DeepReadonly<Negotiation>,
  name: string,
  ratio: Traced<number>,
): Traced<number> {
  const children: TraceNode[] = [
    inputOf('Promotion', name, { kind: 'promotion', id: negotiation.promotionId }).trace,
    { ...ratio.trace, label: 'Offer against their ask' },
  ];
  if (matchesTheirCounter(negotiation)) {
    children.push({
      kind: 'branch',
      label: MATCHES_COUNTER_REASON,
      value: true,
      condition: MATCHES_COUNTER_REASON,
      taken: true,
    });
  }
  return {
    value: ratio.value,
    trace: {
      kind: 'formula',
      label: `${name}: ${ratio.value.toFixed(2)} ${SCORE_LABEL_SUFFIX}`,
      value: ratio.value,
      unit: 'ratio',
      docRef: REVIEW_DOC_REF,
      children,
    },
  };
}

/** Drops an offer the worker can no longer sign, closing its talks; else scores it. */
function candidateOf(ctx: PhaseContext, negotiation: DeepReadonly<Negotiation>): Candidate | null {
  const promotion = ctx.read.tables.promotions.get(negotiation.promotionId);
  if (promotion === undefined || promotion.status === 'closed') {
    closeTalks(ctx, negotiation, { status: 'declined', outcomeCode: PROMOTION_CLOSED_OUTCOME });
    return null;
  }
  if (negotiation.kind === 'renewal') {
    const contract = ctx.read.tables.employments.get(negotiation.employmentId);
    if (contract?.status !== 'signed' && contract?.status !== 'active') {
      closeTalks(ctx, negotiation, { status: 'declined', outcomeCode: CONTRACT_ENDED_OUTCOME });
      return null;
    }
  }
  const evaluation = evaluateOffer(ctx.read, ctx.tunables, {
    promotionId: negotiation.promotionId,
    personId: negotiation.personId,
    offer: copyOffer(negotiation.offer),
    negotiation,
    date: ctx.date,
  });
  if (evaluation.refusal !== null || evaluation.roleMismatch !== null) {
    closeTalks(ctx, negotiation, {
      status: 'declined',
      outcomeCode: evaluation.refusal?.code ?? REFUSES_ROLE_CODE,
    });
    return null;
  }
  const name = promotion.name;
  return {
    negotiation,
    promotionName: name,
    score: scoreOf(negotiation, name, offerRatio(evaluation.offerValue, evaluation.askValue)),
  };
}

/** The review decision over `candidates` (at least one), with the tie-break roll if needed. */
function decide(
  ctx: PhaseContext,
  ringName: string,
  candidates: readonly Candidate[],
): { winner: Candidate; decision: Decision<NegotiationId> } {
  const decision = startDecision<NegotiationId>('Which offer they sign', {
    docRef: REVIEW_DOC_REF,
  });
  for (const candidate of candidates) {
    decision.consider(candidate.negotiation.id, candidate.score, candidate.promotionName);
  }
  const best = Math.max(...candidates.map((candidate) => candidate.score.value));
  const epsilon = decision.tunable(ctx.tunables, 'contracts.review.tieEpsilon');
  const top = candidates.filter((candidate) => best - candidate.score.value <= epsilon);
  let [winner] = top;
  if (winner === undefined) {
    throw new Error('review: no candidates');
  }
  if (top.length > 1) {
    decision.rule(
      `${String(top.length)} offers scored within ${String(epsilon)} of each other`,
      true,
    );
    const roll = rollPick(
      ctx.rng(REVIEW_STREAM),
      top,
      `Which of the tied offers ${ringName} takes`,
      (candidate) => candidate.promotionName,
    );
    decision.roll(roll.roll);
    winner = roll.value;
  }
  return { winner, decision };
}

/** Reviews one worker's agreed offers. */
function reviewPerson(ctx: PhaseContext, personId: PersonId): void {
  const awaiting = ctx.read.tables.negotiations
    .lookup('byPerson', personId)
    .filter((row) => row.status === 'awaitingReview')
    .sort((left, right) => compareIds(left.id, right.id));
  const candidates: Candidate[] = [];
  for (const negotiation of awaiting) {
    const candidate = candidateOf(ctx, negotiation);
    if (candidate !== null) {
      candidates.push(candidate);
    }
  }
  if (candidates.length === 0) {
    return;
  }
  const person = ctx.read.tables.people.require(personId);
  const { winner, decision } = decide(ctx, person.defaultRingName, candidates);
  const deal = signNegotiation(
    ctx,
    ctx.read.tables.negotiations.require(winner.negotiation.id),
    reviewTraceRef(winner.negotiation.id),
  );
  for (const note of deal.notes) {
    decision.note(note);
  }
  const trace = decision.choose(winner.negotiation.id, `Signs with ${winner.promotionName}`);
  for (const candidate of candidates) {
    const human =
      ctx.read.tables.promotions.get(candidate.negotiation.promotionId)?.controller.kind ===
      'human';
    ctx.recordTrace(reviewTraceRef(candidate.negotiation.id), ctx.date, trace, {
      summaryOnly: !human,
    });
  }
  // Every other open negotiation for the worker loses, naming the winner.
  for (const negotiation of ctx.read.tables.negotiations.lookup('byPerson', personId)) {
    if (negotiation.id === winner.negotiation.id || !isOpenNegotiationStatus(negotiation.status)) {
      continue;
    }
    const compared = candidates.some((candidate) => candidate.negotiation.id === negotiation.id);
    closeTalks(ctx, negotiation, {
      status: 'declined',
      outcomeCode: LOST_TO_OTHER_OFFER_OUTCOME,
      otherPromotionId: winner.negotiation.promotionId,
      ...(compared ? { reviewTraceId: reviewTraceId(negotiation.id) } : {}),
    });
  }
}

/** Reviews every worker whose earliest review day has come, in person id order. */
export function reviewDueOffers(ctx: PhaseContext): void {
  const earliest = new Map<PersonId, GameDate>();
  for (const negotiation of ctx.read.tables.negotiations.lookup('byStatus', 'awaitingReview')) {
    const { reviewOn } = negotiation;
    if (reviewOn === null) {
      continue;
    }
    const seen = earliest.get(negotiation.personId);
    if (seen === undefined || compareDates(reviewOn, seen) < 0) {
      earliest.set(negotiation.personId, reviewOn);
    }
  }
  const due = [...earliest.entries()]
    .filter(([, reviewOn]) => compareDates(reviewOn, ctx.date) <= 0)
    .map(([personId]) => personId)
    .sort(compareIds);
  for (const personId of due) {
    reviewPerson(ctx, personId);
  }
}
