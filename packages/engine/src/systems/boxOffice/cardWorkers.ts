/**
 * Who worked a show's card, for the workers' shares of its gate and merch (EVT6-05).
 *
 * Every distinct person in any segment of the card, the pre-show included, except people who are
 * only talked about (`subject`): they are not working. Each one's active contract with the show's
 * promotion gives the ring name and the shares (`terms.shares.gateBp` and `merchBp`); a guest with
 * no contract there has no share. A rival show with no card (EVT3's off-screen score) has no
 * workers and so no shares. Design: docs/design/box-office.md#settlement.
 */

import type { PersonId } from '../../core/ids';
import type { EventInstance } from '../../model/entities/event-instance';
import { compareIds } from '../../model/table';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';

/** One worker on the card with a contract with the show's promotion. */
export interface CardWorker {
  readonly personId: PersonId;
  /** The ring name on their contract with the show's promotion. */
  readonly name: string;
  /** Their share of the gate, in basis points. */
  readonly gateBp: number;
  /** Their share of the merch, in basis points. */
  readonly merchBp: number;
}

/** The card's workers under contract with the show's promotion, in person id order. */
export function cardWorkersOf(
  read: GameWorldView,
  instance: DeepReadonly<Pick<EventInstance, 'id' | 'promotionId'>>,
): CardWorker[] {
  const personIds = new Set<PersonId>();
  for (const segment of read.tables.segments.lookup('byEventInstance', instance.id)) {
    for (const participant of read.tables.participants.lookup('bySegment', segment.id)) {
      if (participant.role !== 'subject') {
        personIds.add(participant.personId);
      }
    }
  }
  const workers: CardWorker[] = [];
  for (const personId of [...personIds].sort(compareIds)) {
    const contract = read.tables.employments
      .lookup('byPerson', personId)
      .find((row) => row.status === 'active' && row.promotionId === instance.promotionId);
    if (contract !== undefined) {
      workers.push({
        personId,
        name: contract.ringName,
        gateBp: contract.terms.shares.gateBp,
        merchBp: contract.terms.shares.merchBp,
      });
    }
  }
  return workers;
}
