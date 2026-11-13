/**
 * The auto-winner's inputs, read from the world (MTCH2-03).
 *
 * For each competitor: popularity in the show's region (`person.regionalPop[regionId]`, 0 when
 * absent), and push, momentum and alignment from the person's **active** employment with the
 * promotion running the show. Free agents and other promotions' workers (the lab's "Everyone"
 * picker) get push `none`, momentum null and alignment null.
 *
 * MTCH2-09 adds how the match would go: each competitor's ringwork, psychology, athleticism and
 * stamina (any promotion's worker has them), their fatigue and their mean body condition, and each
 * side's storyline heat: the hottest active storyline linked to the match (`storylineIds`) in which
 * one of the side's competitors is on the face side. The Match lab links no storyline.
 *
 * Only competitors count: ringside people and interferers never win. The caller passes competitor
 * ids only; `competitorSidesOf` groups stored participants that way.
 *
 * Design: docs/design/match-finishes.md#auto-winner.
 */

import { InvalidArgumentError } from '../../../core/errors';
import type { PersonId, PromotionId, RegionId, StorylineId } from '../../../core/ids';
import type { Employment } from '../../../model/entities/employment';
import type { Participant } from '../../../model/entities/participant';
import type { GameWorldView } from '../../../model/tables';
import type { Person } from '../../../model/entities/person';
import type { DeepReadonly } from '../../../model/world';
import type { AutoWinnerCompetitor, AutoWinnerStorylineHeat } from '../formulas/autoWinnerScore';
import { sideLabel } from '../formulas/workRate';

/** One side's competitors, by stored 0-based side number. */
export interface AutoWinnerSideIds {
  readonly side: number;
  readonly personIds: readonly PersonId[];
}

/** One side as `autoWinner` and `resolveMatchOutcome` read it. */
export interface AutoWinnerSide {
  /** Stored 0-based side number. */
  readonly side: number;
  /** "Side 1". */
  readonly sideLabel: string;
  /** In ascending person id order. */
  readonly competitors: readonly AutoWinnerCompetitor[];
  /** The storyline this side is the crowd favourite in, or null (MTCH2-09). */
  readonly storylineHeat: AutoWinnerStorylineHeat | null;
}

export interface AutoWinnerInputsArgs {
  /** The promotion running the show. */
  readonly promotionId: PromotionId;
  /** The show's region. */
  readonly regionId: RegionId;
  readonly sides: readonly AutoWinnerSideIds[];
  /** The storylines linked to the match; none in the Match lab. */
  readonly storylineIds?: readonly StorylineId[];
}

function compareIds(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

/** The person's active employment with `promotionId`, if any. */
function activeEmploymentWith(
  read: GameWorldView,
  personId: PersonId,
  promotionId: PromotionId,
): Employment | undefined {
  return read.tables.employments
    .lookup('byPerson', personId)
    .find((employment) => employment.status === 'active' && employment.promotionId === promotionId);
}

/** Mean condition over every body part, 0..100; 100 when the record is empty. */
function meanBodyCondition(person: DeepReadonly<Person>): number {
  const parts = Object.values(person.condition);
  if (parts.length === 0) {
    return 100;
  }
  return parts.reduce((sum, value) => sum + value, 0) / parts.length;
}

/**
 * The hottest active linked storyline in which one of `personIds` is on the face side; ties go to
 * the storyline listed first.
 */
function storylineHeatOf(
  read: GameWorldView,
  storylineIds: readonly StorylineId[],
  personIds: readonly PersonId[],
): AutoWinnerStorylineHeat | null {
  let best: AutoWinnerStorylineHeat | null = null;
  for (const storylineId of storylineIds) {
    const storyline = read.tables.storylines.get(storylineId);
    if (storyline?.status !== 'active') {
      continue;
    }
    const favoured = storyline.members.some(
      (member) => member.side === 'face' && personIds.includes(member.personId),
    );
    if (favoured && (best === null || storyline.heat > best.heat)) {
      best = { storylineName: storyline.name, heat: storyline.heat };
    }
  }
  return best;
}

/** The competitors in stored participants, grouped by side (ascending). */
export function competitorSidesOf(
  participants: readonly Pick<Participant, 'personId' | 'role' | 'side'>[],
): AutoWinnerSideIds[] {
  const bySide = new Map<number, PersonId[]>();
  for (const participant of participants) {
    if (participant.role !== 'competitor') {
      continue;
    }
    bySide.set(participant.side, [...(bySide.get(participant.side) ?? []), participant.personId]);
  }
  return [...bySide.entries()]
    .sort(([left], [right]) => left - right)
    .map(([side, personIds]) => ({ side, personIds }));
}

/**
 * Every side's auto-winner inputs, in ascending side order, each side's competitors in ascending
 * person id order.
 *
 * @throws InvalidArgumentError for a person id the world does not have.
 */
export function autoWinnerInputsOf(
  read: GameWorldView,
  args: AutoWinnerInputsArgs,
): AutoWinnerSide[] {
  return [...args.sides]
    .sort((left, right) => left.side - right.side)
    .map((side) => ({
      side: side.side,
      sideLabel: sideLabel(side.side),
      storylineHeat: storylineHeatOf(read, args.storylineIds ?? [], side.personIds),
      competitors: [...side.personIds].sort(compareIds).map((personId): AutoWinnerCompetitor => {
        const person = read.tables.people.get(personId);
        if (person === undefined) {
          throw new InvalidArgumentError(
            'autoWinnerInputsOf',
            'personId',
            personId,
            'a person in the world',
          );
        }
        const employment = activeEmploymentWith(read, personId, args.promotionId);
        return {
          personId,
          name: employment?.ringName ?? person.defaultRingName,
          popularityInRegion: person.regionalPop[args.regionId] ?? 0,
          push: employment?.push ?? 'none',
          momentum: employment?.momentum ?? null,
          alignment: employment?.alignment ?? null,
          ringwork: person.attributes.ringwork,
          psychology: person.attributes.psychology,
          athleticism: person.attributes.athleticism,
          stamina: person.attributes.stamina,
          fatigue: person.fatigue,
          bodyCondition: meanBodyCondition(person),
        };
      }),
    }));
}
