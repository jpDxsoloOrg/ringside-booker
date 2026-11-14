/**
 * What a promotion does in a negotiation (ECO5-04), as plain functions every controller calls:
 * the player's commands, a rival's hiring (ECO6) and a second human's sealed intents (MP6) all go
 * through `submitOffer`, `answerCounter` and `withdrawNegotiation`, so the rules and the side
 * effects are the same for everyone (D-07). The commands only add validation and logging.
 *
 * - `submitOffer` opens talks: for a signing it creates the `offered` employment the talks point
 *   at; for a renewal the talks point at the live contract. It records the worker's asking terms
 *   (`contracts.ask`, round 1) and publishes `negotiation.opened`.
 * - `answerCounter` answers a counter-offer: accept it (the worker then reviews it), send a revised
 *   offer (a new round that uses a point of patience) or end the talks.
 * - `withdrawNegotiation` takes an open offer back.
 *
 * Nothing here makes the worker react: that happens when the day runs (ECO5-05). Every function
 * re-checks the offer, so a caller that resolves later (MP6) cannot record one the rules refuse.
 *
 * Design: docs/design/negotiation.md#rounds and #commands.
 */

import { controlsPromotion, type Controller } from '../../core/api/controller';
import type { Reason } from '../../core/api/result';
import { addDays, addMonths, compareDates, type GameDate } from '../../core/date';
import { InvalidArgumentError } from '../../core/errors';
import type { EmploymentId, NegotiationId, PromotionId } from '../../core/ids';
import type { PhaseContext } from '../../core/pipeline/context';
import { startDecision } from '../../core/trace/decision';
import { canTransition, type Alignment, type Employment } from '../../model/entities/employment';
import {
  isOpenNegotiationStatus,
  NEGOTIATION_HISTORY_MAX,
  type Negotiation,
  type NegotiationRound,
  type NegotiationStatus,
} from '../../model/entities/negotiation';
import type { Person } from '../../model/entities/person';
import type { DeepReadonly } from '../../model/world';
import { negotiationEligibility } from './eligibility';
import { meetsCounter, type OfferEvaluation } from './evaluate';
import { ASKING_TERMS_DOC_REF } from './formulas/shared';
import type { Offer } from './offer';
import { askTraceRef } from './traceKinds';
import {
  checkOffer,
  NOT_YOUR_PROMOTION_CODE,
  NOT_YOUR_PROMOTION_TEXT,
  type OfferInput,
} from './validate';

/** Outcome codes the promotion's own actions close talks with. */
export const WITHDRAWN_OUTCOME = 'withdrawn';
export const TALKS_ENDED_OUTCOME = 'talksEnded';

export const NOT_COUNTERED_CODE = 'contracts.notCountered';
export const UNKNOWN_NEGOTIATION_CODE = 'contracts.unknownNegotiation';
export const NOT_OPEN_CODE = 'contracts.notOpen';
export const OFFER_REQUIRED_CODE = 'contracts.offerRequired';

/** What `submitOffer` takes: the offer, and for a renewal the live contract it extends. */
export interface SubmitOfferInput extends OfferInput {
  readonly renewalOf?: EmploymentId | undefined;
}

export interface SubmitOfferResult {
  readonly negotiationId: NegotiationId;
  /** The one evaluation the offer was weighed with before the talks opened (the preview's). */
  readonly evaluation: OfferEvaluation;
}

/** How the promotion answers a counter-offer. */
export type CounterResponse = 'accept' | 'revise' | 'end';

export interface AnswerCounterArgs {
  readonly negotiationId: NegotiationId;
  readonly response: CounterResponse;
  /** The revised offer; required for `revise`. */
  readonly offer?: Offer | undefined;
}

export interface AnswerCounterResult {
  readonly negotiationId: NegotiationId;
  readonly status: NegotiationStatus;
  /** How the worker is expected to react to the offer now on the table; null once talks ended. */
  readonly evaluation: OfferEvaluation | null;
}

function refuse(functionName: string, reasons: readonly Reason[]): never {
  throw new InvalidArgumentError(
    functionName,
    'input',
    reasons.map((entry) => entry.code).join(', '),
    'an offer the negotiation rules allow',
  );
}

function alignmentOf(person: DeepReadonly<Person>): Alignment {
  if (person.traits.includes('naturalHeel')) {
    return 'heel';
  }
  return 'face';
}

/** The first day under the offered contract: the offer's start, never before talks may start. */
function startOf(offer: Offer, earliestStart: GameDate, date: GameDate): GameDate {
  const wanted = offer.startsOn ?? date;
  return compareDates(wanted, earliestStart) >= 0 ? wanted : earliestStart;
}

/** The offer's terms as the `offered` employment holds them. */
function mirroredFields(
  offer: Offer,
  startsOn: GameDate,
): Pick<Employment, 'terms' | 'startsOn' | 'endsOn' | 'role' | 'push' | 'brandId'> {
  return {
    terms: offer.terms,
    startsOn,
    endsOn: addMonths(startsOn, offer.lengthMonths),
    role: offer.role,
    push: offer.push,
    brandId: offer.brand.kind === 'brand' ? offer.brand.brandId : null,
  };
}

function recordAsk(
  ctx: PhaseContext,
  negotiationId: NegotiationId,
  round: number,
  evaluation: OfferEvaluation,
  promotionId: PromotionId,
): void {
  const { ask } = evaluation;
  const decision = startDecision<string>('Their asking terms', { docRef: ASKING_TERMS_DOC_REF });
  decision.include('Monthly wage asked', ask.monthlyWage);
  decision.include('Fee asked per appearance', ask.perAppearanceFee);
  decision.include('Signing bonus asked', ask.signingBonus);
  decision.include('Value of their ask', evaluation.askValue);
  decision.include('Patience at the start', ask.startPatience);
  const human = ctx.read.tables.promotions.get(promotionId)?.controller.kind === 'human';
  ctx.recordTrace(
    askTraceRef(negotiationId, round),
    ctx.date,
    decision.choose(ask.kind, 'The kind of contract offered'),
    { summaryOnly: !human },
  );
}

/** Keeps the newest rounds: the promotion's oldest offers go first, then the oldest of any. */
export function cappedHistory(history: readonly NegotiationRound[]): NegotiationRound[] {
  const kept = [...history];
  while (kept.length > NEGOTIATION_HISTORY_MAX) {
    const oldestOwn = kept.findIndex((entry) => entry.by === 'promotion');
    kept.splice(oldestOwn === -1 ? 0 : oldestOwn, 1);
  }
  return kept;
}

function historyCopy(negotiation: DeepReadonly<Negotiation>): NegotiationRound[] {
  return negotiation.history.map((entry) => structuredClone(entry) as NegotiationRound);
}

/**
 * Opens talks: checks the offer (`validateOffer`'s rules, throwing `InvalidArgumentError` when
 * they refuse it), creates the `offered` employment of a signing, the negotiation, the ask trace
 * and the `negotiation.opened` event.
 */
export function submitOffer(
  ctx: PhaseContext,
  input: SubmitOfferInput,
  issuedBy: Controller,
): SubmitOfferResult {
  const check = checkOffer(ctx.read, ctx.tunables, input, issuedBy, { date: ctx.date });
  if (check.reasons.length > 0 || check.evaluation === null) {
    refuse('submitOffer', check.reasons);
  }
  const { evaluation } = check;
  const { offer, personId, promotionId } = input;
  let employmentId: EmploymentId;
  if (input.renewalOf === undefined) {
    const person = ctx.read.tables.people.require(personId);
    const eligibility = negotiationEligibility(
      ctx.read,
      ctx.tunables,
      personId,
      promotionId,
      ctx.date,
    );
    const employment = ctx.tx.create('employments', {
      personId,
      promotionId,
      managerPersonId: null,
      status: 'offered',
      offeredOn: ctx.date,
      endedOn: null,
      ringName: person.defaultRingName,
      gimmickKey: null,
      alignment: alignmentOf(person),
      morale: 0,
      momentum: null,
      appearancesThisYear: 0,
      lastAppearanceOn: null,
      leave: null,
      ...mirroredFields(offer, startOf(offer, eligibility.earliestStart, ctx.date)),
    });
    employmentId = employment.id;
  } else {
    employmentId = input.renewalOf;
  }
  const startPatience = evaluation.ask.startPatience.value;
  const negotiation = ctx.tx.create('negotiations', {
    kind: input.renewalOf === undefined ? 'signing' : 'renewal',
    personId,
    promotionId,
    employmentId,
    status: 'submitted',
    round: 1,
    startPatience,
    patience: startPatience,
    offer,
    lastCounter: null,
    history: [{ round: 1, date: ctx.date, by: 'promotion', offer, reaction: null }],
    openedOn: ctx.date,
    submittedOn: ctx.date,
    counterExpiresOn: null,
    reviewOn: null,
    closedOn: null,
    outcome: null,
    cooldownUntil: null,
    reactionTraceId: null,
    reviewTraceId: null,
  });
  recordAsk(ctx, negotiation.id, 1, evaluation, promotionId);
  ctx.publish('negotiation.opened', {
    negotiationId: negotiation.id,
    personId,
    promotionId,
    kind: negotiation.kind,
  });
  ctx.log(`Offer made to ${ctx.read.tables.people.require(personId).defaultRingName}`);
  return { negotiationId: negotiation.id, evaluation };
}

/** Moves a signing's `offered` employment to `withdrawn` (the offer is off the table). */
function withdrawOfferedEmployment(
  ctx: PhaseContext,
  negotiation: DeepReadonly<Negotiation>,
): void {
  if (negotiation.kind !== 'signing') {
    return;
  }
  const employment = ctx.read.tables.employments.require(negotiation.employmentId);
  if (!canTransition(employment.status, 'withdrawn')) {
    throw new InvalidArgumentError(
      'withdrawNegotiation',
      'employment.status',
      employment.status,
      'an offered employment',
    );
  }
  ctx.tx.update('employments', employment.id, { status: 'withdrawn', endedOn: ctx.date });
}

/** Closes open talks the promotion walks away from, with its employment, and says so. */
function closeByPromotion(
  ctx: PhaseContext,
  negotiation: DeepReadonly<Negotiation>,
  outcomeCode: string,
): void {
  withdrawOfferedEmployment(ctx, negotiation);
  ctx.tx.update('negotiations', negotiation.id, {
    status: 'withdrawn',
    closedOn: ctx.date,
    lastCounter: null,
    counterExpiresOn: null,
    reviewOn: null,
    outcome: { code: outcomeCode, otherPromotionId: null },
  });
  ctx.publish('negotiation.closed', {
    negotiationId: negotiation.id,
    personId: negotiation.personId,
    promotionId: negotiation.promotionId,
    status: 'withdrawn',
    outcomeCode,
  });
}

/** Mirrors the offer on a signing's `offered` employment, so contract queries see it. */
function mirrorOffer(
  ctx: PhaseContext,
  negotiation: DeepReadonly<Negotiation>,
  offer: Offer,
): void {
  if (negotiation.kind !== 'signing') {
    return;
  }
  const eligibility = negotiationEligibility(
    ctx.read,
    ctx.tunables,
    negotiation.personId,
    negotiation.promotionId,
    ctx.date,
  );
  ctx.tx.update(
    'employments',
    negotiation.employmentId,
    mirroredFields(offer, startOf(offer, eligibility.earliestStart, ctx.date)),
  );
}

/** Takes open talks back: the negotiation and a signing's offered employment become `withdrawn`. */
export function withdrawNegotiation(
  ctx: PhaseContext,
  negotiationId: NegotiationId,
  issuedBy: Controller,
): { negotiationId: NegotiationId } {
  const negotiation = ctx.read.tables.negotiations.get(negotiationId);
  const reasons = withdrawReasons(ctx.read, negotiation, issuedBy);
  if (reasons.length > 0 || negotiation === undefined) {
    refuse('withdrawNegotiation', reasons);
  }
  closeByPromotion(ctx, negotiation, WITHDRAWN_OUTCOME);
  ctx.log(`Offer to ${ctx.read.tables.people.require(negotiation.personId).defaultRingName} withdrawn`);
  return { negotiationId };
}

/**
 * Answers a counter-offer. `accept` takes their counter (they decide on the review day); `revise`
 * sends a new offer (a new round, one point of patience); `end` closes the talks with no cooldown.
 * A revision that pays their counter (or more money on the same terms) counts as accepting it.
 */
export function answerCounter(
  ctx: PhaseContext,
  args: AnswerCounterArgs,
  issuedBy: Controller,
): AnswerCounterResult {
  const negotiation = ctx.read.tables.negotiations.get(args.negotiationId);
  const reasons = answerCounterReasons(ctx.read, ctx.tunables, args, negotiation, issuedBy);
  if (reasons.length > 0 || negotiation === undefined || negotiation.lastCounter === null) {
    refuse('answerCounter', reasons);
  }
  if (args.response === 'end') {
    closeByPromotion(ctx, negotiation, TALKS_ENDED_OUTCOME);
    return { negotiationId: negotiation.id, status: 'withdrawn', evaluation: null };
  }
  const counter = structuredClone(negotiation.lastCounter) as Offer;
  const offer = args.response === 'accept' || args.offer === undefined ? counter : args.offer;
  const accepting = args.response === 'accept' || meetsCounter(offer, counter);
  const input: OfferInput = {
    promotionId: negotiation.promotionId,
    personId: negotiation.personId,
    offer,
  };
  const check = checkOffer(ctx.read, ctx.tunables, input, issuedBy, {
    negotiation,
    date: ctx.date,
  });
  if (check.evaluation === null) {
    refuse('answerCounter', check.reasons);
  }
  const round = negotiation.round + 1;
  const history = cappedHistory([
    ...historyCopy(negotiation),
    { round, date: ctx.date, by: 'promotion', offer, reaction: null },
  ]);
  const status: NegotiationStatus = accepting ? 'awaitingReview' : 'submitted';
  ctx.tx.update('negotiations', negotiation.id, {
    status,
    round,
    patience: check.evaluation.patience,
    offer,
    lastCounter: null,
    counterExpiresOn: null,
    reviewOn: accepting ? addDays(ctx.date, ctx.tunables.get('contracts.review.delayDays')) : null,
    submittedOn: ctx.date,
    history,
  });
  mirrorOffer(ctx, negotiation, offer);
  recordAsk(ctx, negotiation.id, round, check.evaluation, negotiation.promotionId);
  ctx.log(
    `${accepting ? 'Counter-offer accepted' : 'Revised offer sent'}: ${ctx.read.tables.people.require(negotiation.personId).defaultRingName}`,
  );
  return { negotiationId: negotiation.id, status, evaluation: check.evaluation };
}

function ownTalksReasons(
  read: PhaseContext['read'],
  negotiation: DeepReadonly<Negotiation> | undefined,
  issuedBy: Controller,
): Reason[] {
  if (negotiation === undefined) {
    return [
      {
        code: UNKNOWN_NEGOTIATION_CODE,
        message: 'Those talks are not in this game any more',
        field: 'negotiationId',
      },
    ];
  }
  if (!controlsPromotion(read, negotiation.promotionId, issuedBy)) {
    return [
      {
        code: NOT_YOUR_PROMOTION_CODE,
        message: NOT_YOUR_PROMOTION_TEXT,
        field: 'negotiationId',
      },
    ];
  }
  if (!isOpenNegotiationStatus(negotiation.status)) {
    return [
      {
        code: NOT_OPEN_CODE,
        message: 'Those talks have already ended',
        field: 'negotiationId',
        subject: { kind: 'negotiation', id: negotiation.id },
      },
    ];
  }
  return [];
}

/** Why `issuedBy` may not withdraw these talks; empty when they may. */
export function withdrawReasons(
  read: PhaseContext['read'],
  negotiation: DeepReadonly<Negotiation> | undefined,
  issuedBy: Controller,
): Reason[] {
  return ownTalksReasons(read, negotiation, issuedBy);
}

/** Why `issuedBy` may not answer this counter-offer this way; empty when they may. */
export function answerCounterReasons(
  read: PhaseContext['read'],
  tunables: PhaseContext['tunables'],
  args: AnswerCounterArgs,
  negotiation: DeepReadonly<Negotiation> | undefined,
  issuedBy: Controller,
): Reason[] {
  const own = ownTalksReasons(read, negotiation, issuedBy);
  if (own.length > 0 || negotiation === undefined) {
    return own;
  }
  if (negotiation.status !== 'countered' || negotiation.lastCounter === null) {
    return [
      {
        code: NOT_COUNTERED_CODE,
        message:
          negotiation.status === 'awaitingReview'
            ? 'They are already thinking your offer over'
            : 'They have not answered your offer yet: wait for their reply',
        field: 'negotiationId',
        subject: { kind: 'negotiation', id: negotiation.id },
      },
    ];
  }
  if (args.response === 'end') {
    return [];
  }
  if (args.response === 'revise' && args.offer === undefined) {
    return [
      { code: OFFER_REQUIRED_CODE, message: 'Choose the terms of your new offer', field: 'offer' },
    ];
  }
  const offer =
    args.response === 'accept' || args.offer === undefined
      ? (structuredClone(negotiation.lastCounter) as Offer)
      : args.offer;
  return checkOffer(
    read,
    tunables,
    { promotionId: negotiation.promotionId, personId: negotiation.personId, offer },
    issuedBy,
    { negotiation },
  ).reasons;
}
