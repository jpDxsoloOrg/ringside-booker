/**
 * Signing (ECO5-05): the review picked an offer, so the worker signs it. One place does it, for
 * every promotion and controller (D-07).
 *
 * A new contract: the `offered` employment becomes `signed` with the final start date (the
 * offer's, never before the earliest day they are free or today) and the end date that follows
 * from the length; it starts straight away through ECO4's `startContract` when that day is today.
 * An exclusive deal cuts the worker's non-exclusive deals elsewhere short so they end the day it
 * starts. A renewal changes the live contract in place: new terms, a later end date, and push and
 * role through WRK1's doors. Either way the signing bonus is posted through `postMoney` on the
 * signing day (even for a deal that starts later; cash may go negative), the negotiation closes as
 * `signed` and `contract.signed` is published. Morale is never touched.
 *
 * Design: docs/design/negotiation.md#review.
 */

import { addMonths, compareDates, type GameDate } from '../../core/date';
import { InvalidArgumentError } from '../../core/errors';
import type { EmploymentId } from '../../core/ids';
import { cents } from '../../core/money';
import type { PhaseContext } from '../../core/pipeline/context';
import { startCalc } from '../../core/trace/calc';
import type { TraceRef } from '../../core/trace/store';
import { canTransition, type Employment } from '../../model/entities/employment';
import type { Negotiation } from '../../model/entities/negotiation';
import type { DeepReadonly } from '../../model/world';
import { EXCLUSIVE_DEAL_REASON_KEY } from '../contracts/lifecycle';
import { endEmployment } from '../contracts/endEmployment';
import { startContract } from '../contracts/lifecycle';
import { postMoney } from '../finance/post';
import { setPush, setRole, setRoleProblems, type DoorSource } from '../workers/doors';
import { closeTalks, SIGNED_OUTCOME } from './close';
import { negotiationEligibility } from './eligibility';
import { moneyText } from './formulas/shared';
import { offerKind } from './registries';
import { signingBonusTraceRef } from './traceKinds';

export const SIGNING_DOC_REF = 'negotiation.md#review';
/** The reason key push and role changes of a signed renewal carry. */
export const RENEWAL_REASON_KEY = 'contracts.renewalSigned';

/** What a signing did, for the review's trace. */
export interface SignedDeal {
  readonly employmentId: EmploymentId;
  readonly startsOn: GameDate;
  readonly endsOn: GameDate | null;
  /** Lines for the decision trace, such as "Went exclusive with Altura". */
  readonly notes: string[];
}

function laterOf(left: GameDate, right: GameDate): GameDate {
  return compareDates(left, right) >= 0 ? left : right;
}

function sourceOf(ctx: PhaseContext, negotiation: DeepReadonly<Negotiation>): DoorSource {
  const promotion = ctx.read.tables.promotions.get(negotiation.promotionId);
  return promotion?.controller.kind === 'human' ? 'player' : 'ai';
}

/**
 * An exclusive deal starting on `startsOn`: every other promotion's signed or active
 * non-exclusive deal for the person ends the day it starts (`endsOn` = its first day), or is
 * withdrawn when it would not start before then. One starting today is left to `startContract`,
 * which ends it as an exclusive handover.
 */
function cutDealsElsewhere(
  ctx: PhaseContext,
  signed: DeepReadonly<Employment>,
  startsOn: GameDate,
): boolean {
  let cut = false;
  for (const other of ctx.read.tables.employments.lookup('byPerson', signed.personId)) {
    if (
      other.id === signed.id ||
      other.promotionId === signed.promotionId ||
      other.terms.exclusive ||
      (other.status !== 'signed' && other.status !== 'active')
    ) {
      continue;
    }
    if (compareDates(other.startsOn, startsOn) >= 0) {
      if (other.status === 'signed') {
        endEmployment(ctx, {
          employmentId: other.id,
          to: 'withdrawn',
          reasonKey: EXCLUSIVE_DEAL_REASON_KEY,
          source: 'system',
        });
        cut = true;
      }
      continue;
    }
    if (compareDates(startsOn, ctx.date) <= 0) {
      continue;
    }
    if (other.endsOn === null || compareDates(other.endsOn, startsOn) > 0) {
      ctx.tx.update('employments', other.id, { endsOn: startsOn });
      cut = true;
    }
  }
  return cut;
}

function postSigningBonus(
  ctx: PhaseContext,
  negotiation: DeepReadonly<Negotiation>,
  ringName: string,
): void {
  const bonus = negotiation.offer.terms.signingBonus;
  if (bonus <= 0) {
    return;
  }
  const agreed = startCalc('Signing bonus', bonus, {
    unit: 'money',
    docRef: SIGNING_DOC_REF,
    startLabel: `Agreed signing bonus ${moneyText(bonus)}`,
  }).done();
  const human =
    ctx.read.tables.promotions.get(negotiation.promotionId)?.controller.kind === 'human';
  ctx.recordTrace(signingBonusTraceRef(negotiation.id), ctx.date, agreed, {
    summaryOnly: !human,
  });
  const paid = startCalc('Signing bonus paid', 0, {
    unit: 'money',
    docRef: SIGNING_DOC_REF,
    startLabel: 'Nothing paid yet',
  })
    .subtract(`Signing bonus for ${ringName}`, agreed)
    .done();
  postMoney(ctx, {
    promotionId: negotiation.promotionId,
    category: 'signingBonuses',
    amount: cents(paid.value),
    memo: `Signing bonus: ${ringName}`,
    refs: { personId: negotiation.personId },
    trace: paid,
  });
}

function signNew(ctx: PhaseContext, negotiation: DeepReadonly<Negotiation>): SignedDeal {
  const employment = ctx.read.tables.employments.require(negotiation.employmentId);
  if (!canTransition(employment.status, 'signed')) {
    throw new InvalidArgumentError(
      'signNegotiation',
      'employment.status',
      employment.status,
      'an offered employment',
    );
  }
  const { offer } = negotiation;
  const { earliestStart } = negotiationEligibility(
    ctx.read,
    ctx.tunables,
    negotiation.personId,
    negotiation.promotionId,
    ctx.date,
  );
  const startsOn = laterOf(laterOf(offer.startsOn ?? ctx.date, earliestStart), ctx.date);
  const endsOn = addMonths(startsOn, offer.lengthMonths);
  // Terms, role, push and brand were mirrored on the offered row with every offer (ECO5-04).
  ctx.tx.update('employments', employment.id, { status: 'signed', startsOn, endsOn });
  const notes: string[] = [];
  if (offer.terms.exclusive && cutDealsElsewhere(ctx, employment, startsOn)) {
    const promotion = ctx.read.tables.promotions.get(negotiation.promotionId);
    notes.push(`Went exclusive with ${promotion?.name ?? 'a promotion'}`);
  }
  if (compareDates(startsOn, ctx.date) <= 0) {
    startContract(ctx, employment.id);
  }
  offerKind(offer.terms.kind)?.onSigned?.(ctx, employment.id, { ...offer.extra });
  return { employmentId: employment.id, startsOn, endsOn, notes };
}

function signRenewal(ctx: PhaseContext, negotiation: DeepReadonly<Negotiation>): SignedDeal {
  const contract = ctx.read.tables.employments.require(negotiation.employmentId);
  const { offer } = negotiation;
  const previousEndsOn = contract.endsOn;
  const endsOn = addMonths(previousEndsOn ?? ctx.date, offer.lengthMonths);
  ctx.tx.update('employments', contract.id, {
    terms: {
      ...offer.terms,
      shares: { ...offer.terms.shares },
      perks: { ...offer.terms.perks },
    },
    endsOn,
    brandId: offer.brand.kind === 'brand' ? offer.brand.brandId : null,
  });
  const source = sourceOf(ctx, negotiation);
  const reason = { key: RENEWAL_REASON_KEY, label: 'Agreed in a contract renewal' };
  const notes: string[] = [];
  if (offer.role !== contract.role) {
    const [problem] = setRoleProblems(ctx.read, contract.id, offer.role);
    if (problem === undefined) {
      setRole(ctx, { employmentId: contract.id, role: offer.role, source, reason });
    } else {
      notes.push(`Role kept: ${problem.message}`);
    }
  }
  if (offer.push !== ctx.read.tables.employments.require(contract.id).push) {
    setPush(ctx, { employmentId: contract.id, push: offer.push, source, reason });
  }
  if (previousEndsOn !== null) {
    ctx.publish('contract.renewed', {
      employmentId: contract.id,
      personId: contract.personId,
      promotionId: contract.promotionId,
      previousEndsOn,
      endsOn,
      source,
    });
  }
  return { employmentId: contract.id, startsOn: contract.startsOn, endsOn, notes };
}

/**
 * Signs the winning offer of a review: the contract, the signing bonus, the closed negotiation and
 * `contract.signed`. `decisionTraceRef` is where the review's decision is stored.
 */
export function signNegotiation(
  ctx: PhaseContext,
  negotiation: DeepReadonly<Negotiation>,
  decisionTraceRef: TraceRef,
): SignedDeal {
  const renewal = negotiation.kind === 'renewal';
  const deal = renewal ? signRenewal(ctx, negotiation) : signNew(ctx, negotiation);
  const employment = ctx.read.tables.employments.require(deal.employmentId);
  postSigningBonus(ctx, negotiation, employment.ringName);
  closeTalks(ctx, negotiation, {
    status: 'signed',
    outcomeCode: SIGNED_OUTCOME,
    reviewTraceId: decisionTraceRef.id,
  });
  ctx.publish('contract.signed', {
    employmentId: employment.id,
    personId: negotiation.personId,
    promotionId: negotiation.promotionId,
    brandId: employment.brandId,
    renewal,
    negotiationId: negotiation.id,
  });
  ctx.log(
    `${employment.ringName} signed with ${ctx.read.tables.promotions.get(negotiation.promotionId)?.name ?? 'a promotion'}`,
  );
  return deal;
}
