/**
 * The one place an offer is weighed (ECO5-03). The Negotiation Sheet's preview
 * (`contracts.offerPreview`), the offer commands (ECO5-04) and the review phase (ECO5-05) all call
 * `evaluateOffer`, so the meter always shows what the worker does next (barring a changed ask or
 * patience).
 *
 * - The ask is worked out for the offer's own kind and exclusivity, so an exclusive offer is
 *   weighed against the exclusive ask.
 * - The ask's value is `contractValue` of the ask itself (its money and perks, at the push they
 *   expect and the length they prefer): submitting the ask unchanged is worth exactly 1.0 of it.
 * - The worker refuses outright when they will not renew (`ask.refusal`), when talks are blocked
 *   (`negotiationEligibility`), while they are still cooling off after walking away from this
 *   promotion (`cooldownUntil` on a closed negotiation; eligibility does not check it), or when
 *   they will not take the offered role (`roles.ts`).
 * - Patience is the negotiation's, or the worker's starting patience before talks open.
 *
 * Nothing is rolled or written here.
 *
 * Design: docs/design/negotiation.md#reaction.
 */

import type { Reason } from '../../core/api/result';
import { compareDates, type GameDate } from '../../core/date';
import type { EmploymentId, PersonId, PromotionId } from '../../core/ids';
import type { Traced } from '../../core/trace/types';
import type { ContractTerms } from '../../model/entities/employment';
import {
  personPromotionKey,
  type Negotiation,
  type Reaction,
} from '../../model/entities/negotiation';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';
import { plainDate } from '../health/gate';
import type { EngineTunables } from '../tunables';
import { askingTermsFor, type AskingTerms } from './asking';
import { askedMoney, perkOfTerm } from './counter';
import { negotiationEligibility } from './eligibility';
import { contractValue } from './formulas/contractValue';
import { offerReaction } from './formulas/offerReaction';
import type { Offer } from './offer';
import { listEnforcedTerms, type EnforceableTerm } from './registries';
import { roleMismatch } from './roles';

export const COOLING_OFF_CODE = 'contracts.coolingOff';

export interface EvaluateOfferRequest {
  readonly promotionId: PromotionId;
  readonly personId: PersonId;
  readonly offer: Offer;
  /** The talks the offer belongs to, or null before any are open. */
  readonly negotiation: DeepReadonly<Negotiation> | null;
  readonly date: GameDate;
  /**
   * The contract being renewed when there is no negotiation yet. A renewal negotiation's own
   * employment wins. The caller checks it belongs to the promotion.
   */
  readonly renewalOf?: EmploymentId | undefined;
}

export interface OfferEvaluation {
  readonly ask: AskingTerms;
  readonly offerValue: Traced<number>;
  readonly askValue: Traced<number>;
  /** The offer's value as a share of the ask's (1 = exactly the ask). */
  readonly ratio: number;
  readonly reaction: Traced<Reaction>;
  /**
   * Patience before the worker reacts to this offer: the negotiation's (`roundPatience`), or the
   * worker's starting patience before talks open.
   */
  readonly patience: number;
  /**
   * Patience after this reaction: a counter uses up one, a rejection
   * `contracts.patience.rejectCost`, a walk-away or refusal all of it; an acceptance none.
   */
  readonly patienceLeft: number;
  /** Why they will not sign with you at all, or null. */
  readonly refusal: Reason | null;
  /** Why they will not take the offered role, or null. */
  readonly roleMismatch: string | null;
}

/** The terms the game honours today. */
export function enforcedTermsNow(): ReadonlySet<EnforceableTerm> {
  return new Set(listEnforcedTerms().map((spec) => spec.term));
}

/** The ask as contract terms, so its value is worked out exactly like an offer's. */
export function askTermsOf(ask: AskingTerms): ContractTerms {
  const perks = {
    creativeControl: false,
    noHouseShows: false,
    ironClad: false,
    travelCovered: false,
  };
  for (const perk of ask.perks) {
    const flag = perkOfTerm(perk.term);
    if (flag !== null) {
      perks[flag] = true;
    }
  }
  return {
    kind: ask.kind,
    exclusive: ask.exclusive,
    ...askedMoney(ask),
    shares: { gateBp: 0, merchBp: 0, broadcastBp: 0 },
    appearanceCap: ask.appearanceCap?.value ?? null,
    perks,
  };
}

/**
 * True when `offer` is the worker's counter-offer, or the same with more money: every term but the
 * wage, the fee and the signing bonus equal, and none of those lower.
 */
export function meetsCounter(offer: Offer, counter: DeepReadonly<Offer>): boolean {
  const money = ['monthlyWage', 'perAppearanceFee', 'signingBonus'] as const;
  if (money.some((field) => offer.terms[field] < counter.terms[field])) {
    return false;
  }
  const rest = (value: DeepReadonly<Offer>): string =>
    JSON.stringify([
      value.terms.kind,
      value.terms.exclusive,
      value.terms.shares.gateBp,
      value.terms.shares.merchBp,
      value.terms.shares.broadcastBp,
      value.terms.appearanceCap,
      value.terms.perks.creativeControl,
      value.terms.perks.noHouseShows,
      value.terms.perks.ironClad,
      value.terms.perks.travelCovered,
      value.startsOn,
      value.lengthMonths,
      value.brand.kind,
      value.brand.kind === 'brand' ? value.brand.brandId : null,
      value.role,
      value.push,
      Object.entries(value.extra).sort(([left], [right]) => (left < right ? -1 : 1)),
    ]);
  return rest(offer) === rest(counter);
}

/** The day the worker talks to this promotion again after walking away, or null. */
export function coolingOffUntil(
  read: GameWorldView,
  personId: PersonId,
  promotionId: PromotionId,
  date: GameDate,
): GameDate | null {
  let until: GameDate | null = null;
  for (const negotiation of read.tables.negotiations.lookup(
    'byPersonPromotion',
    personPromotionKey(personId, promotionId),
  )) {
    const end = negotiation.cooldownUntil;
    if (
      end !== null &&
      compareDates(end, date) > 0 &&
      (until === null || compareDates(end, until) > 0)
    ) {
      until = end;
    }
  }
  return until;
}

function refusalOf(
  read: GameWorldView,
  tunables: EngineTunables,
  request: EvaluateOfferRequest,
  ask: AskingTerms,
): Reason | null {
  if (ask.refusal !== null) {
    return ask.refusal;
  }
  const eligibility = negotiationEligibility(
    read,
    tunables,
    request.personId,
    request.promotionId,
    request.date,
  );
  const [blocked] = eligibility.reasons;
  if (blocked !== undefined) {
    return blocked;
  }
  const until = coolingOffUntil(read, request.personId, request.promotionId, request.date);
  if (until !== null) {
    return {
      code: COOLING_OFF_CODE,
      message: `Walked away from talks with you; will talk again on ${plainDate(until)}`,
      subject: { kind: 'person', id: request.personId },
    };
  }
  return null;
}

function patienceAfter(reaction: Reaction, patience: number, tunables: EngineTunables): number {
  switch (reaction) {
    case 'accept':
      return patience;
    case 'counter':
      return Math.max(0, patience - 1);
    case 'reject':
      return Math.max(0, patience - tunables.get('contracts.patience.rejectCost'));
    case 'walkAway':
    case 'refuse':
      return 0;
  }
}

/**
 * The patience an offer in these talks is weighed with: the negotiation's own. A round costs one
 * point of patience in all (owner decision, ECO5-05): the worker's counter-offer uses it when they
 * make it (`patienceAfter`), so sending a revision in reply costs nothing more, and paying their
 * counter-offer costs nothing at all. The preview, the revise command and the review all weigh the
 * offer with this same number. Kept as a function (and `meetsTheirCounter` as an argument) so a
 * later rule can charge for a revision again in one place. Design: negotiation.md#rounds.
 */
export function roundPatience(
  negotiation: DeepReadonly<Negotiation>,
  meetsTheirCounter: boolean,
): number {
  void meetsTheirCounter;
  return negotiation.patience;
}

/** Weighs `offer` against what the worker asks, and how they react to it. */
export function evaluateOffer(
  read: GameWorldView,
  tunables: EngineTunables,
  request: EvaluateOfferRequest,
): OfferEvaluation {
  const { offer, negotiation } = request;
  const renewalOf = negotiation?.kind === 'renewal' ? negotiation.employmentId : request.renewalOf;
  const ask = askingTermsFor(read, tunables, {
    personId: request.personId,
    promotionId: request.promotionId,
    date: request.date,
    kind: offer.terms.kind,
    exclusive: offer.terms.exclusive,
    renewalOf,
  });
  const enforced = enforcedTermsNow();
  const expectedPush = ask.expectedPush.value;
  const preferredLengthMonths = ask.preferredLengthMonths.value;
  const offerValue = contractValue(
    {
      terms: offer.terms,
      lengthMonths: offer.lengthMonths,
      push: offer.push,
      expectedPush,
      preferredLengthMonths,
      enforced,
    },
    { tunables },
  );
  const askValue = contractValue(
    {
      terms: askTermsOf(ask),
      lengthMonths: preferredLengthMonths,
      push: expectedPush,
      expectedPush,
      preferredLengthMonths,
      enforced,
    },
    { tunables },
  );
  const refusal = refusalOf(read, tunables, request, ask);
  const person = read.tables.people.require(request.personId);
  const mismatch = roleMismatch(person, offer.role, { tunables });
  const lastCounter = negotiation?.status === 'countered' ? negotiation.lastCounter : null;
  const matchesLastCounter = lastCounter !== null && meetsCounter(offer, lastCounter);
  const patience =
    negotiation === null ? ask.startPatience.value : roundPatience(negotiation, matchesLastCounter);
  const reaction = offerReaction(
    {
      offerValue,
      askValue,
      patience,
      refusal,
      roleMismatch: mismatch,
      matchesLastCounter,
    },
    { tunables },
  );
  return {
    ask,
    offerValue,
    askValue,
    ratio: askValue.value > 0 ? offerValue.value / askValue.value : 1,
    reaction,
    patience,
    patienceLeft: patienceAfter(reaction.value, patience, tunables),
    refusal,
    roleMismatch: mismatch,
  };
}
