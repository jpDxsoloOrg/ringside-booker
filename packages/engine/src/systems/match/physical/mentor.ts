/**
 * Mentor on the card (MTCH4-03): whether a worker's mentor is on the same show.
 *
 * Reads the foundation `relationships` table directly (one row per pair, any order), so it needs no
 * social-system code: a pair with the `mentorship` bond whose `mentorId` is the other person. The
 * default world has no relationship rows until the social system creates them, so without them
 * nobody has a mentor on the card.
 *
 * Design: docs/design/physical-toll.md#ring-learning.
 */

import type { PersonId } from '../../../core/ids';
import type { GameWorldView } from '../../../model/tables';

/** The worker's mentor, when one is on the card. */
export interface MentorOnCard {
  readonly mentorId: PersonId;
  readonly name: string;
}

/**
 * The mentor of `personId` among `cardPersonIds` (everyone on the same show in any role, the
 * producer included; in the Match lab, everyone in the lab segment), or `null`. With more than one,
 * the lowest mentor id wins. `nameOf` names the mentor; it defaults to their default ring name.
 */
export function mentorOnCard(
  read: GameWorldView,
  personId: PersonId,
  cardPersonIds: Iterable<PersonId>,
  nameOf?: (mentorId: PersonId) => string,
): MentorOnCard | null {
  const onCard = new Set(cardPersonIds);
  const mentors = read.tables.relationships
    .lookup('byPerson', personId)
    .filter(
      (relationship) =>
        relationship.bonds.includes('mentorship') &&
        relationship.mentorId !== null &&
        relationship.mentorId !== personId &&
        onCard.has(relationship.mentorId),
    )
    .map((relationship) => relationship.mentorId)
    .filter((mentorId): mentorId is PersonId => mentorId !== null)
    .sort();
  const mentorId = mentors[0];
  if (mentorId === undefined) {
    return null;
  }
  const name = nameOf?.(mentorId) ?? read.tables.people.require(mentorId).defaultRingName;
  return { mentorId, name };
}
