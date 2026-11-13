/**
 * Who worked a show, for its costs (ECO1-04).
 *
 * With a card: every distinct person on it (participants in every role and every segment's crew,
 * through EVT3's `distinctWorkersOf`), each matched to their active contract with the show's
 * promotion. A worker in three segments counts once. Someone with no contract there is a guest and
 * costs the promotion nothing; the owner and booker are left out by the payroll rule
 * (`finance.payOwnerAndBooker`).
 *
 * Without a card (a rival show scored off-screen) the card is estimated from the roster: the first
 * `format.slots × finance.show.offscreenWorkersPerSlot` active wrestler contracts, top of the card
 * first, then by id.
 *
 * Design: docs/design/finances.md#show-costs.
 */

import type { EmploymentId, PersonId, PromotionId } from '../../core/ids';
import { ZERO_CENTS, type Cents } from '../../core/money';
import { promotionStatusKey, PUSH_LEVELS, type Employment } from '../../model/entities/employment';
import type { EventInstance } from '../../model/entities/event-instance';
import type { Promotion } from '../../model/entities/promotion';
import { compareIds } from '../../model/table';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';
import { distinctWorkersOf } from '../shows/appearances';
import type { EngineTunables } from '../tunables';
import { isOwnerOrBooker } from './payroll';

/** Why a worker on the card costs the promotion nothing. */
export type ShowWorkerExclusion = 'guest' | 'ownerOrBooker';

/** One distinct person who worked a show. */
export interface ShowWorker {
  personId: PersonId;
  /** The ring name on their contract, or the person's ring name for a guest. */
  name: string;
  /** Their active contract with the show's promotion, or null for a guest. */
  employmentId: EmploymentId | null;
  /** The contract's per-appearance fee (0 for a guest). */
  perAppearanceFee: Cents;
  /** The contract has the travel perk. */
  travelCovered: boolean;
  /** Why the worker costs nothing, or null when the promotion pays for them. */
  excluded: ShowWorkerExclusion | null;
}

/** The workers of one show, and whether they were estimated from the roster. */
export interface ShowWorkers {
  workers: ShowWorker[];
  /** True when the show had no card and the workers were estimated from the roster. */
  estimated: boolean;
}

function workerOf(
  employment: DeepReadonly<Employment>,
  promotion: Pick<Promotion, 'ownerPersonId' | 'bookerPersonId'>,
  payOwnerAndBooker: boolean,
): ShowWorker {
  return {
    personId: employment.personId,
    name: employment.ringName,
    employmentId: employment.id,
    perAppearanceFee: employment.terms.perAppearanceFee,
    travelCovered: employment.terms.perks.travelCovered,
    excluded: !payOwnerAndBooker && isOwnerOrBooker(employment, promotion) ? 'ownerOrBooker' : null,
  };
}

function activeContractOf(
  read: GameWorldView,
  personId: PersonId,
  promotionId: PromotionId,
): DeepReadonly<Employment> | undefined {
  return read.tables.employments
    .lookup('byPerson', personId)
    .find((row) => row.status === 'active' && row.promotionId === promotionId);
}

/** The first `count` active wrestler contracts of the promotion, top of the card first, then id. */
function estimatedCard(
  read: GameWorldView,
  promotionId: PromotionId,
  count: number,
): DeepReadonly<Employment>[] {
  return read.tables.employments
    .lookup('byPromotionStatus', promotionStatusKey(promotionId, 'active'))
    .filter((employment) => employment.role === 'wrestler')
    .sort(
      (left, right) =>
        PUSH_LEVELS.indexOf(left.push) - PUSH_LEVELS.indexOf(right.push) ||
        compareIds(left.id, right.id),
    )
    .slice(0, count);
}

/** Everyone who worked `instance`, or the estimated card when it has none. */
export function showWorkersOf(
  read: GameWorldView,
  instance: Pick<DeepReadonly<EventInstance>, 'id' | 'promotionId' | 'format'>,
  tunables: EngineTunables,
): ShowWorkers {
  const promotion = read.tables.promotions.require(instance.promotionId);
  const payOwnerAndBooker = tunables.get('finance.payOwnerAndBooker');
  const segments = read.tables.segments.lookup('byEventInstance', instance.id);

  if (segments.length === 0) {
    const count = instance.format.slots * tunables.get('finance.show.offscreenWorkersPerSlot');
    return {
      workers: estimatedCard(read, instance.promotionId, count)
        .map((employment) => workerOf(employment, promotion, payOwnerAndBooker))
        .sort((left, right) => compareIds(left.personId, right.personId)),
      estimated: true,
    };
  }

  const workers = distinctWorkersOf(read, segments).map((personId): ShowWorker => {
    const employment = activeContractOf(read, personId, instance.promotionId);
    if (employment !== undefined) {
      return workerOf(employment, promotion, payOwnerAndBooker);
    }
    const person = read.tables.people.get(personId);
    return {
      personId,
      name: person?.defaultRingName ?? personId,
      employmentId: null,
      perAppearanceFee: ZERO_CENTS,
      travelCovered: false,
      excluded: 'guest',
    };
  });
  return { workers, estimated: false };
}
