/**
 * Relationships: how two people feel about each other and what ties them.
 *
 * There is exactly one row per pair of people. The pair is stored in canonical order
 * (`personAId < personBId`), and the unique `byPair` index refuses a second row for the same pair,
 * so "how do A and B get on?" never has two answers. How affinity changes and decays is a SOC
 * design; this module only fixes the shape.
 */

import { z } from 'zod';
import { compareDates } from '../../core/date';
import type { PersonId } from '../../core/ids';
import { zGameDate, zId, zSigned100 } from '../primitives';
import { defineTable } from '../table-def';
import { hasDuplicates } from './unique';

export const RELATIONSHIP_BONDS = [
  'friends',
  'rivals',
  'dating',
  'engaged',
  'married',
  'relatives',
  'mentorship',
] as const;
export const RelationshipBondSchema = z.enum(RELATIONSHIP_BONDS);
export type RelationshipBond = z.infer<typeof RelationshipBondSchema>;

/** Romantic bonds: a pair holds at most one of them at a time. */
export const ROMANTIC_BONDS = [
  'dating',
  'engaged',
  'married',
] as const satisfies readonly RelationshipBond[];

/** The canonical `"a|b"` key of a pair of people, whichever order they are given in. */
export function relationshipKey(firstPersonId: PersonId, secondPersonId: PersonId): string {
  return firstPersonId < secondPersonId
    ? `${firstPersonId}|${secondPersonId}`
    : `${secondPersonId}|${firstPersonId}`;
}

export const RelationshipSchema = z
  .strictObject({
    id: zId('relationship'),
    /** The smaller of the two person IDs. */
    personAId: zId('person'),
    /** The larger of the two person IDs. */
    personBId: zId('person'),
    affinity: zSigned100,
    bonds: z.array(RelationshipBondSchema),
    /** The mentor of a mentorship: one of the pair, required exactly when bonds has mentorship. */
    mentorId: zId('person').nullable(),
    since: zGameDate,
    lastChangedOn: zGameDate,
  })
  .superRefine((relationship, context) => {
    const issue = (path: string[], message: string): void => {
      context.addIssue({ code: 'custom', path, message });
    };
    if (relationship.personAId >= relationship.personBId) {
      issue(
        ['personBId'],
        'personAId must sort before personBId (canonical order, no self-relationship)',
      );
    }
    if (hasDuplicates(relationship.bonds)) {
      issue(['bonds'], 'Bonds must be unique');
    }
    const romantic = relationship.bonds.filter((bond) =>
      ROMANTIC_BONDS.some((romanticBond) => romanticBond === bond),
    );
    if (new Set(romantic).size > 1) {
      issue(
        ['bonds'],
        `Only one of dating, engaged and married at a time (got ${romantic.join(', ')})`,
      );
    }
    const isMentorship = relationship.bonds.includes('mentorship');
    if (isMentorship && relationship.mentorId === null) {
      issue(['mentorId'], 'A mentorship needs a mentorId');
    }
    if (!isMentorship && relationship.mentorId !== null) {
      issue(['mentorId'], 'mentorId must be null without a mentorship bond');
    }
    if (
      relationship.mentorId !== null &&
      relationship.mentorId !== relationship.personAId &&
      relationship.mentorId !== relationship.personBId
    ) {
      issue(['mentorId'], 'The mentor must be one of the pair');
    }
    if (compareDates(relationship.lastChangedOn, relationship.since) < 0) {
      issue(['lastChangedOn'], 'lastChangedOn must not be before since');
    }
  });

export type Relationship = z.infer<typeof RelationshipSchema>;

export const relationshipsTable = defineTable({
  kind: 'relationship',
  name: 'relationships',
  schema: RelationshipSchema,
  refs: [
    { path: 'personAId', target: 'person', nullable: false },
    { path: 'personBId', target: 'person', nullable: false },
    { path: 'mentorId', target: 'person', nullable: true },
  ],
  indexes: [
    {
      name: 'byPerson',
      key: (relationship) => [relationship.personAId, relationship.personBId],
    },
    {
      name: 'byPair',
      key: (relationship) => relationshipKey(relationship.personAId, relationship.personBId),
      unique: true,
    },
  ],
});
