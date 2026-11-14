/**
 * The rules every offer passes before it is recorded (ECO5-04), shared by the player's commands,
 * a rival's hiring (ECO6) and a second human's sealed intents (MP6), so nobody gets a different
 * rule set (D-07).
 *
 * `validateOffer` returns every reason an offer may not be made, each with player-facing text and
 * a stable code. The order is the order the player meets them: whose promotion it is, whether the
 * worker will talk at all, then the terms themselves.
 *
 * Design: docs/design/negotiation.md#commands.
 */

import { controlsPromotion, type Controller } from '../../core/api/controller';
import type { Reason } from '../../core/api/result';
import { addDays, compareDates, diffDays, type GameDate } from '../../core/date';
import type { EmploymentId, PersonId, PromotionId } from '../../core/ids';
import type { Employment } from '../../model/entities/employment';
import {
  isOpenNegotiationStatus,
  personPromotionKey,
  type Negotiation,
} from '../../model/entities/negotiation';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';
import { plainDate } from '../health/gate';
import type { EngineTunables } from '../tunables';
import { REFUSES_RENEWAL_CODE } from './asking';
import { negotiationEligibility, OPEN_TO_OFFERS } from './eligibility';
import { coolingOffUntil, evaluateOffer, type OfferEvaluation } from './evaluate';
import type { Offer } from './offer';
import { isTermEnforced, offerKind } from './registries';
import { WANTS_TO_WRESTLE } from './roles';

export const NOT_YOUR_PROMOTION_CODE = 'contracts.notYourPromotion';
export const UNKNOWN_WORKER_CODE = 'contracts.unknownWorker';
export const UNAVAILABLE_CODE = 'contracts.unavailable';
export const COOLDOWN_CODE = 'contracts.cooldown';
export const ALREADY_NEGOTIATING_CODE = 'contracts.alreadyNegotiating';
export const KIND_NOT_ALLOWED_CODE = 'contracts.kindNotAllowed';
export const EXCLUSIVE_NOT_ALLOWED_CODE = 'contracts.exclusiveNotAllowed';
export const BAD_TERMS_CODE = 'contracts.badTerms';
export const BAD_BRAND_CODE = 'contracts.badBrand';
export const BAD_ROLE_CODE = 'contracts.badRole';
export const REFUSES_ROLE_CODE = 'contracts.refusesRole';
export const BAD_KIND_EXTRA_CODE = 'contracts.badKindExtra';
export { REFUSES_RENEWAL_CODE };
export const UNKNOWN_CONTRACT_CODE = 'contracts.unknownContract';
export const NOT_RENEWABLE_CODE = 'contracts.notRenewable';
export const RENEWAL_NOT_OPEN_CODE = 'contracts.renewalNotOpen';

export const NOT_YOUR_PROMOTION_TEXT = "You don't run that promotion";
export const ALREADY_YOURS_TEXT = 'Already under contract with you: offer a renewal instead';
export const ALREADY_NEGOTIATING_TEXT =
  'You are already talking to them: open those talks to see where they stand';

/** What an offer is for. */
export interface OfferInput {
  readonly promotionId: PromotionId;
  readonly personId: PersonId;
  readonly offer: Offer;
  /** The live contract with this promotion a renewal extends; left out for a signing. */
  readonly renewalOf?: EmploymentId | undefined;
}

/** A revision checks the offer inside talks already open, so those talks are not "in the way". */
export interface OfferCheckOptions {
  /** The open talks this offer belongs to (a revision), or null for a first offer. */
  readonly negotiation?: DeepReadonly<Negotiation> | null;
  /** The day the offer is made; left out: the world's current date. */
  readonly date?: GameDate;
}

/** The reasons, and the one evaluation behind them (null when the world refused before it). */
export interface OfferCheck {
  readonly reasons: Reason[];
  readonly evaluation: OfferEvaluation | null;
}

function reason(
  code: string,
  message: string,
  extra: Pick<Reason, 'field' | 'subject'> = {},
): Reason {
  return { code, message, ...extra };
}

/** The open talks between this worker and promotion, or undefined. */
export function openNegotiationFor(
  read: GameWorldView,
  personId: PersonId,
  promotionId: PromotionId,
): DeepReadonly<Negotiation> | undefined {
  return read.tables.negotiations
    .lookup('byPersonPromotion', personPromotionKey(personId, promotionId))
    .find((row) => isOpenNegotiationStatus(row.status));
}

function termReasons(
  input: OfferInput,
  tunables: EngineTunables,
  date: GameDate,
  startChecked: boolean,
): Reason[] {
  const { offer } = input;
  const { terms } = offer;
  const reasons: Reason[] = [];
  const bad = (field: string, message: string): void => {
    reasons.push(reason(BAD_TERMS_CODE, message, { field }));
  };
  if (terms.kind === 'perAppearance' && terms.monthlyWage > 0) {
    bad('offer.terms.monthlyWage', 'A per-appearance deal has no monthly wage');
  }
  for (const field of ['monthlyWage', 'perAppearanceFee', 'signingBonus'] as const) {
    if (terms[field] < 0) {
      bad(`offer.terms.${field}`, 'Money terms cannot be below zero');
    }
  }
  const maxMonths = tunables.get('contracts.offer.maxLengthMonths');
  if (offer.lengthMonths > maxMonths) {
    bad('offer.lengthMonths', `Contracts run at most ${String(maxMonths)} months`);
  }
  if (startChecked && offer.startsOn !== null && compareDates(offer.startsOn, date) < 0) {
    bad('offer.startsOn', 'The start date has already passed');
  }
  if (terms.appearanceCap !== null && terms.appearanceCap <= 0) {
    bad('offer.terms.appearanceCap', 'An appearance cap must allow at least one appearance');
  }
  const shares = [
    ['gateBp', 'share.gateBp', 'A share of the gate'],
    ['merchBp', 'share.merchBp', 'A share of merch'],
    ['broadcastBp', 'share.broadcastBp', 'A share of TV money'],
  ] as const;
  for (const [field, term, words] of shares) {
    if (terms.shares[field] > 0 && !isTermEnforced(term)) {
      bad(`offer.terms.shares.${field}`, `${words} is not paid by the game yet; leave it at 0`);
    }
  }
  return reasons;
}

function brandReasons(read: GameWorldView, input: OfferInput): Reason[] {
  const { brand } = input.offer;
  if (brand.kind !== 'brand') {
    return [];
  }
  const row = read.tables.brands.get(brand.brandId);
  if (row?.promotionId !== input.promotionId) {
    return [
      reason(BAD_BRAND_CODE, 'That brand is not one of yours', { field: 'offer.brand.brandId' }),
    ];
  }
  if (!row.active) {
    return [
      reason(BAD_BRAND_CODE, `${row.name} is not running any more`, {
        field: 'offer.brand.brandId',
      }),
    ];
  }
  return [];
}

function extraReasons(input: OfferInput): Reason[] {
  const spec = offerKind(input.offer.terms.kind);
  const extra = input.offer.extra;
  if (spec?.extraSchema === undefined) {
    return Object.keys(extra).length === 0
      ? []
      : [
          reason(BAD_KIND_EXTRA_CODE, 'This kind of contract has no extra terms', {
            field: 'offer.extra',
          }),
        ];
  }
  const parsed = spec.extraSchema.safeParse(extra);
  if (parsed.success) {
    return [];
  }
  const [issue] = parsed.error.issues;
  return [
    reason(BAD_KIND_EXTRA_CODE, issue?.message ?? `The ${spec.label} terms are not complete`, {
      field: ['offer.extra', ...(issue?.path ?? []).map(String)].join('.'),
    }),
  ];
}

function kindReasons(input: OfferInput, evaluation: OfferEvaluation): Reason[] {
  const { ask } = evaluation;
  const { terms } = input.offer;
  const reasons: Reason[] = [];
  const kind = ask.allowedKinds.find((entry) => entry.kind === terms.kind);
  if (kind === undefined) {
    reasons.push(
      reason(KIND_NOT_ALLOWED_CODE, 'That kind of contract cannot be offered yet', {
        field: 'offer.terms.kind',
      }),
    );
  } else if (!kind.allowed) {
    const [first] = kind.reasons;
    reasons.push(
      reason(KIND_NOT_ALLOWED_CODE, first?.message ?? `${kind.label}s are not open to you`, {
        field: 'offer.terms.kind',
        ...(first?.subject === undefined ? {} : { subject: first.subject }),
      }),
    );
  }
  if (terms.exclusive && !ask.exclusiveAllowed) {
    const [first] = ask.exclusiveReasons;
    reasons.push(
      reason(EXCLUSIVE_NOT_ALLOWED_CODE, first?.message ?? 'Exclusive deals are not open to you', {
        field: 'offer.terms.exclusive',
        ...(first?.subject === undefined ? {} : { subject: first.subject }),
      }),
    );
  }
  return reasons;
}

function roleReasons(input: OfferInput, evaluation: OfferEvaluation): Reason[] {
  const mismatch = evaluation.roleMismatch;
  if (mismatch === null) {
    return [];
  }
  const subject = { kind: 'person', id: input.personId } as const;
  return [
    reason(mismatch === WANTS_TO_WRESTLE ? REFUSES_ROLE_CODE : BAD_ROLE_CODE, mismatch, {
      field: 'offer.role',
      subject,
    }),
  ];
}

/** The renewal's own rules: a live contract of this worker with this promotion, inside its window. */
export function renewalReasons(
  read: GameWorldView,
  tunables: EngineTunables,
  employment: DeepReadonly<Employment> | undefined,
  date: GameDate,
): Reason[] {
  if (employment === undefined) {
    return [
      reason(UNKNOWN_CONTRACT_CODE, 'That contract is not in this game any more', {
        field: 'employmentId',
      }),
    ];
  }
  const subject = { kind: 'employment', id: employment.id } as const;
  if (employment.status !== 'active' && employment.status !== 'signed') {
    return [
      reason(NOT_RENEWABLE_CODE, `${employment.ringName}'s contract has ended`, {
        field: 'employmentId',
        subject,
      }),
    ];
  }
  if (employment.endsOn === null) {
    return [];
  }
  const windowDays = tunables.get('contracts.renewal.windowDays');
  if (diffDays(date, employment.endsOn) > windowDays) {
    const opens = addDays(employment.endsOn, -windowDays);
    return [
      reason(
        RENEWAL_NOT_OPEN_CODE,
        `Talks open ${String(windowDays)} days before the contract ends (from ${plainDate(opens)})`,
        { field: 'employmentId', subject },
      ),
    ];
  }
  return [];
}

/**
 * Every reason `issuedBy` may not make this offer, with the evaluation that weighed it (the same
 * `evaluateOffer` the preview calls). Reads only.
 */
export function checkOffer(
  read: GameWorldView,
  tunables: EngineTunables,
  input: OfferInput,
  issuedBy: Controller,
  options: OfferCheckOptions = {},
): OfferCheck {
  const date = options.date ?? read.meta.currentDate;
  const negotiation = options.negotiation ?? null;
  const promotion = read.tables.promotions.get(input.promotionId);
  if (promotion === undefined || !controlsPromotion(read, input.promotionId, issuedBy)) {
    return {
      reasons: [reason(NOT_YOUR_PROMOTION_CODE, NOT_YOUR_PROMOTION_TEXT, { field: 'promotionId' })],
      evaluation: null,
    };
  }
  const person = read.tables.people.get(input.personId);
  if (person === undefined) {
    return {
      reasons: [
        reason(UNKNOWN_WORKER_CODE, 'That worker is not in this game any more', {
          field: 'personId',
        }),
      ],
      evaluation: null,
    };
  }
  const subject = { kind: 'person', id: input.personId } as const;
  const renewalOf = negotiation?.kind === 'renewal' ? negotiation.employmentId : input.renewalOf;
  const renewing = renewalOf !== undefined;
  if (renewing) {
    const contract = read.tables.employments.get(renewalOf);
    const yours = contract?.promotionId === input.promotionId && contract.personId === person.id;
    const reasons = yours
      ? renewalReasons(read, tunables, contract, date)
      : renewalReasons(read, tunables, undefined, date);
    if (reasons.length > 0) {
      return { reasons, evaluation: null };
    }
  }

  const reasons: Reason[] = [];
  const eligibility = negotiationEligibility(
    read,
    tunables,
    input.personId,
    input.promotionId,
    date,
  );
  for (const blocked of eligibility.reasons) {
    reasons.push(reason(UNAVAILABLE_CODE, blocked.message, { subject }));
  }
  if (!renewing && eligibility.reasons.length === 0) {
    if (eligibility.situation === 'yours') {
      reasons.push(reason(UNAVAILABLE_CODE, ALREADY_YOURS_TEXT, { subject }));
    } else if (!OPEN_TO_OFFERS.includes(eligibility.situation)) {
      reasons.push(reason(UNAVAILABLE_CODE, 'Not open to offers right now', { subject }));
    }
  }
  const until = coolingOffUntil(read, input.personId, input.promotionId, date);
  if (until !== null) {
    reasons.push(
      reason(COOLDOWN_CODE, `Walked away from talks: try again after ${plainDate(until)}`, {
        subject,
      }),
    );
  }
  const open = openNegotiationFor(read, input.personId, input.promotionId);
  if (open !== undefined && open.id !== negotiation?.id) {
    reasons.push(
      reason(ALREADY_NEGOTIATING_CODE, ALREADY_NEGOTIATING_TEXT, {
        subject: { kind: 'negotiation', id: open.id },
      }),
    );
  }
  if (reasons.length > 0) {
    return { reasons, evaluation: null };
  }

  // A start already on the table (theirs or yours) may have passed: it then means "as soon as
  // possible" (the offered employment starts on the first day it can).
  const sameStart = negotiation !== null && input.offer.startsOn === negotiation.offer.startsOn;
  const evaluation = evaluateOffer(read, tunables, {
    promotionId: input.promotionId,
    personId: input.personId,
    offer: input.offer,
    negotiation,
    date,
    renewalOf,
  });
  reasons.push(
    ...kindReasons(input, evaluation),
    ...termReasons(input, tunables, date, !sameStart),
    ...brandReasons(read, input),
    ...roleReasons(input, evaluation),
    ...extraReasons(input),
  );
  const refusal = evaluation.ask.refusal;
  if (refusal !== null) {
    reasons.push(reason(REFUSES_RENEWAL_CODE, refusal.message, { subject }));
  }
  return { reasons, evaluation };
}

/** Every reason `issuedBy` may not make this offer; empty when it may. Reads only. */
export function validateOffer(
  read: GameWorldView,
  tunables: EngineTunables,
  input: OfferInput,
  issuedBy: Controller,
  options: OfferCheckOptions = {},
): Reason[] {
  return checkOffer(read, tunables, input, issuedBy, options).reasons;
}
