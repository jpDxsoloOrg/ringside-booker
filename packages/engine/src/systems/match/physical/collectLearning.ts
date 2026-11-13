/**
 * Ring learning for one segment (MTCH4-03): every competitor's learning, per attribute and in total,
 * read from the world. The Match lab and MTCH4's show-night applier both call it.
 *
 * Design: docs/design/physical-toll.md#ring-learning.
 */

import type { PersonId } from '../../../core/ids';
import type { Traced } from '../../../core/trace';
import { promotionStatusKey } from '../../../model/entities/employment';
import type { Person } from '../../../model/entities/person';
import type { GameWorldView } from '../../../model/tables';
import type { EngineTunables } from '../../tunables';
import {
  computeRingLearning,
  computeRingLearningTotal,
  type LearningPeer,
  type LearningProducer,
} from '../formulas/ringLearning';
import { loadCarriersBySide, type PhysicalSegmentSpec } from './inputs';
import type { InMatchLearningAttribute } from './learning';
import { learningRoom } from './learningRoom';
import { mentorOnCard } from './mentor';

/** One worker's learning in one segment. */
export interface WorkerRingLearning {
  readonly personId: PersonId;
  readonly name: string;
  /** Points per attribute, each with its own Why?. */
  readonly perAttribute: Readonly<Record<InMatchLearningAttribute, Traced<number>>>;
  /** "Learning in this match": the attributes added up, one line per attribute. */
  readonly total: Traced<number>;
}

interface Named {
  readonly person: Person;
  readonly name: string;
}

function producerInput({ person, name }: Named, alsoCompeting: boolean): LearningProducer {
  return {
    name,
    producing: person.attributes.producing,
    teacher: person.traits.includes('teacher') && !alsoCompeting,
  };
}

/**
 * The ring learning of every competitor in a match segment, side by side and by id within a side.
 * An angle teaches nothing here and gives no entries.
 *
 * `cardPersonIds` is everyone on the same show in any role (the producer included), for the mentor
 * line; left out, it is everyone in the segment and its producer (the Match lab rule).
 *
 * @throws NotFoundError (from `people.require`) for a person the world does not have.
 */
export function collectRingLearning(
  read: GameWorldView,
  spec: PhysicalSegmentSpec,
  deps: { tunables: EngineTunables; cardPersonIds?: Iterable<PersonId> },
): WorkerRingLearning[] {
  const competitors = loadCarriersBySide(spec).flat();
  if (competitors.length === 0) {
    return [];
  }
  const contracts = new Map(
    read.tables.employments
      .lookup('byPromotionStatus', promotionStatusKey(spec.promotionId, 'active'))
      .map((employment) => [employment.personId, employment.ringName]),
  );
  const named = (personId: PersonId): Named => {
    const person = read.tables.people.require(personId);
    return { person, name: contracts.get(personId) ?? person.defaultRingName };
  };
  const workers = competitors.map((personId) => [personId, named(personId)] as const);
  const producerId = spec.crew.producerId;
  // A producer who also wrestles in the match already counts as a teacher among the competitors.
  const producer: LearningProducer | null =
    producerId === null ? null : producerInput(named(producerId), competitors.includes(producerId));
  const cardPersonIds = new Set(
    deps.cardPersonIds ?? [
      ...spec.sides.flat().map((participant) => participant.personId),
      ...(producerId === null ? [] : [producerId]),
    ],
  );
  const nameOf = (personId: PersonId): string =>
    contracts.get(personId) ?? read.tables.people.require(personId).defaultRingName;

  return workers.map(([personId, { person, name }]) => {
    const mentor = mentorOnCard(read, personId, cardPersonIds, nameOf);
    const others = workers.filter(([otherId]) => otherId !== personId);
    const learningFor = (attribute: InMatchLearningAttribute): Traced<number> => {
      const peers: LearningPeer[] = others.map(([, other]) => ({
        name: other.name,
        value: other.person.attributes[attribute],
        teacher: other.person.traits.includes('teacher'),
      }));
      return computeRingLearning(
        {
          name,
          attribute,
          durationClass: spec.durationClass,
          value: person.attributes[attribute],
          traits: person.traits,
          others: peers,
          producer: producerId === personId ? null : producer,
          mentor: mentor === null ? null : { name: mentor.name },
          room: learningRoom(person, attribute, deps.tunables),
        },
        { tunables: deps.tunables },
      );
    };
    const perAttribute: Record<InMatchLearningAttribute, Traced<number>> = {
      ringwork: learningFor('ringwork'),
      psychology: learningFor('psychology'),
      safety: learningFor('safety'),
      stamina: learningFor('stamina'),
    };
    return { personId, name, perAttribute, total: computeRingLearningTotal(perAttribute) };
  });
}
