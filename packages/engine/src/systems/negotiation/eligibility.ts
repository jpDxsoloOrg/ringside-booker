/**
 * Who a promotion may talk to about a contract, and from when (ECO5-02, shared with ECO5-04's
 * offer command).
 *
 * The first rule that matches decides the situation:
 *
 * 1. `unavailable`: retired, deceased or out of the business, or not debuted yet;
 * 2. `yours`: a signed or active contract with this promotion already (a renewal, not a signing);
 * 3. `underContract`: a signed exclusive deal elsewhere that has not started yet, or an active
 *    exclusive deal elsewhere with more than `contracts.offer.approachWindowDays` left (or no end
 *    date). Talks are blocked;
 * 4. `endingSoonElsewhere`: an exclusive deal elsewhere ends within the approach window. Talks
 *    are open; the new deal can start the day after it ends;
 * 5. `perAppearanceElsewhere`: only non-exclusive deals elsewhere;
 * 6. `freeAgent`: no live contract at all.
 *
 * Only public facts are read from another promotion's contract: that it exists, whether it is
 * exclusive and when it ends. Never its money.
 *
 * Design: docs/design/negotiation.md#eligibility.
 */

import type { Reason } from '../../core/api/result';
import { addDays, compareDates, diffDays, isAfter, type GameDate } from '../../core/date';
import type { PersonId, PromotionId } from '../../core/ids';
import type { Employment } from '../../model/entities/employment';
import { compareIds } from '../../model/table';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';
import { plainDate } from '../health/gate';
import type { EngineTunables } from '../tunables';
import { availabilityOf } from '../workers/helpers/availability';

export const NEGOTIATION_SITUATIONS = [
  'freeAgent',
  'perAppearanceElsewhere',
  'endingSoonElsewhere',
  'underContract',
  'yours',
  'unavailable',
] as const;
export type NegotiationSituation = (typeof NEGOTIATION_SITUATIONS)[number];

/** The situations in which a promotion may open talks for a new contract. */
export const OPEN_TO_OFFERS: readonly NegotiationSituation[] = [
  'freeAgent',
  'perAppearanceElsewhere',
  'endingSoonElsewhere',
];

export const UNAVAILABLE_REASON_CODE = 'contracts.unavailable';
export const EXCLUSIVE_ELSEWHERE_REASON_CODE = 'contracts.exclusiveElsewhere';

export interface NegotiationEligibility {
  readonly situation: NegotiationSituation;
  /** The first day a new contract could start. Today unless a deal elsewhere must end first. */
  readonly earliestStart: GameDate;
  /** Promotions the worker has a signed or active contract with, other than this one, by id. */
  readonly otherPromotionIds: PromotionId[];
  /** Why talks are blocked (`unavailable`, `underContract`), else empty. */
  readonly reasons: Reason[];
}

type Row = DeepReadonly<Employment>;

function isLive(employment: Row): boolean {
  return employment.status === 'signed' || employment.status === 'active';
}

function liveEmployments(read: GameWorldView, personId: PersonId): Row[] {
  return read.tables.employments
    .lookup('byPerson', personId)
    .filter(isLive)
    .sort((left, right) => compareIds(left.id, right.id));
}

/** True when talks with this deal's promotion's worker must wait. */
function blocks(employment: Row, date: GameDate, windowDays: number): boolean {
  if (!employment.terms.exclusive) {
    return false;
  }
  if (employment.status === 'signed' && isAfter(employment.startsOn, date)) {
    return true;
  }
  return employment.endsOn === null || diffDays(date, employment.endsOn) > windowDays;
}

function latestEnd(rows: readonly Row[], date: GameDate): GameDate {
  let latest = date;
  for (const row of rows) {
    if (row.endsOn !== null && compareDates(row.endsOn, latest) > 0) {
      latest = row.endsOn;
    }
  }
  return latest;
}

function blockedReason(
  read: GameWorldView,
  personId: PersonId,
  employment: Row,
  windowDays: number,
): Reason {
  const name = read.tables.promotions.get(employment.promotionId)?.name ?? 'another promotion';
  const subject = { kind: 'person', id: personId } as const;
  if (employment.endsOn === null) {
    return {
      code: EXCLUSIVE_ELSEWHERE_REASON_CODE,
      message: `Under an exclusive contract with ${name} with no end date`,
      subject,
    };
  }
  const opens = addDays(employment.endsOn, -windowDays);
  return {
    code: EXCLUSIVE_ELSEWHERE_REASON_CODE,
    message: `Under an exclusive contract with ${name} until ${plainDate(addDays(employment.endsOn, -1))}; talks can start on ${plainDate(opens)}`,
    subject,
  };
}

/** Whether `promotionId` may talk to `personId` about a contract on `date`, and from when. */
export function negotiationEligibility(
  read: GameWorldView,
  tunables: EngineTunables,
  personId: PersonId,
  promotionId: PromotionId,
  date: GameDate,
): NegotiationEligibility {
  const person = read.tables.people.require(personId);
  const live = liveEmployments(read, personId);
  const elsewhere = live.filter((employment) => employment.promotionId !== promotionId);
  const otherPromotionIds = [...new Set(elsewhere.map((employment) => employment.promotionId))];

  const availability = availabilityOf(person, null, date);
  if (availability.status === 'retired' || availability.status === 'notDebuted') {
    return {
      situation: 'unavailable',
      earliestStart: date,
      otherPromotionIds,
      reasons: [
        {
          code: UNAVAILABLE_REASON_CODE,
          message: availability.reason,
          subject: { kind: 'person', id: personId },
        },
      ],
    };
  }

  if (live.some((employment) => employment.promotionId === promotionId)) {
    return { situation: 'yours', earliestStart: date, otherPromotionIds, reasons: [] };
  }

  const windowDays = tunables.get('contracts.offer.approachWindowDays');
  const blocking = elsewhere.filter((employment) => blocks(employment, date, windowDays));
  if (blocking.length > 0) {
    return {
      situation: 'underContract',
      earliestStart: latestEnd(blocking, date),
      otherPromotionIds,
      reasons: blocking.map((employment) => blockedReason(read, personId, employment, windowDays)),
    };
  }

  const exclusive = elsewhere.filter((employment) => employment.terms.exclusive);
  if (exclusive.length > 0) {
    return {
      situation: 'endingSoonElsewhere',
      earliestStart: latestEnd(exclusive, date),
      otherPromotionIds,
      reasons: [],
    };
  }
  if (elsewhere.length > 0) {
    return {
      situation: 'perAppearanceElsewhere',
      earliestStart: date,
      otherPromotionIds,
      reasons: [],
    };
  }
  return { situation: 'freeAgent', earliestStart: date, otherPromotionIds, reasons: [] };
}
