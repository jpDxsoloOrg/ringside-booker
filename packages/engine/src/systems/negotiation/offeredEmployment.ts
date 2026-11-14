/**
 * The `offered` employment a signing negotiation points at (ECO5-04), and keeping it in step with
 * the offer on the table.
 *
 * An offer is not a working contract: it pays nothing and puts nobody on a card, so its first
 * values (push, role, alignment, morale 0) are written here directly, like new-game setup does,
 * not through the doors in `systems/workers/doors.ts`. Once the worker signs (ECO5-05) every change
 * goes through the doors again. This file is the one negotiation file the door-ownership test
 * allows to write those fields (`test/systems/workers/doorOwnership.test.ts`).
 *
 * Design: docs/design/negotiation.md#commands.
 */

import { addMonths, compareDates, type GameDate } from '../../core/date';
import type { PersonId, PromotionId } from '../../core/ids';
import type { PhaseContext } from '../../core/pipeline/context';
import type { Alignment, Employment } from '../../model/entities/employment';
import type { Negotiation } from '../../model/entities/negotiation';
import type { Person } from '../../model/entities/person';
import type { DeepReadonly } from '../../model/world';
import { negotiationEligibility } from './eligibility';
import type { Offer } from './offer';

function alignmentOf(person: DeepReadonly<Person>): Alignment {
  return person.traits.includes('naturalHeel') ? 'heel' : 'face';
}

/** The first day under the offered contract: the offer's start, never before talks may start. */
function startOf(offer: Offer, earliestStart: GameDate, date: GameDate): GameDate {
  const wanted = offer.startsOn ?? date;
  return compareDates(wanted, earliestStart) >= 0 ? wanted : earliestStart;
}

/** The offer's terms as the `offered` employment holds them. */
function mirroredFields(
  ctx: PhaseContext,
  personId: PersonId,
  promotionId: PromotionId,
  offer: Offer,
): Pick<Employment, 'terms' | 'startsOn' | 'endsOn' | 'role' | 'push' | 'brandId'> {
  const { earliestStart } = negotiationEligibility(
    ctx.read,
    ctx.tunables,
    personId,
    promotionId,
    ctx.date,
  );
  const startsOn = startOf(offer, earliestStart, ctx.date);
  return {
    terms: offer.terms,
    startsOn,
    endsOn: addMonths(startsOn, offer.lengthMonths),
    role: offer.role,
    push: offer.push,
    brandId: offer.brand.kind === 'brand' ? offer.brand.brandId : null,
  };
}

/** Creates the `offered` employment of a new signing. */
export function createOfferedEmployment(
  ctx: PhaseContext,
  input: { personId: PersonId; promotionId: PromotionId; offer: Offer },
): Employment {
  const { personId, promotionId, offer } = input;
  const person = ctx.read.tables.people.require(personId);
  return ctx.tx.create('employments', {
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
    ...mirroredFields(ctx, personId, promotionId, offer),
  });
}

/** Mirrors the offer on a signing's `offered` employment, so contract queries see it. */
export function mirrorOffer(
  ctx: PhaseContext,
  negotiation: DeepReadonly<Negotiation>,
  offer: Offer,
): void {
  if (negotiation.kind !== 'signing') {
    return;
  }
  ctx.tx.update(
    'employments',
    negotiation.employmentId,
    mirroredFields(ctx, negotiation.personId, negotiation.promotionId, offer),
  );
}
