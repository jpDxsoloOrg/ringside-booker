/**
 * Participants: who is in a segment, on which side, in what role.
 *
 * Participants are their own table rather than a list on the segment because "every segment this
 * person was in" is a hot query (history, morale, momentum, AI booking), and the `byPerson` index
 * answers it without scanning every segment. A participant is a person (`PersonId`), never an
 * employment.
 *
 * Design notes: docs/design/data-model.md, "Titles, events, storylines and seasons".
 */

import { z } from 'zod';
import { defineTable } from '../table-def';
import { zId, zPositiveInt } from '../primitives';

/**
 * Sides are numbered from 0 up to `MAX_SIDE` (up to 30 sides). A singles match uses sides 0 and 1;
 * an eight-way match uses 0..7; a 30-person battle royal uses 0..29. Screens label side `n` as
 * "Side n+1".
 */
export const MAX_SIDE = 29;

/**
 * - `competitor`: wrestles in the match (or is the focus of an angle);
 * - `ringside`: a manager or second at ringside;
 * - `interferer`: gets involved in a match they are not in;
 * - `speaker`: talks in an angle;
 * - `subject`: an angle is about them without them speaking.
 */
export const PARTICIPANT_ROLES = [
  'competitor',
  'ringside',
  'interferer',
  'speaker',
  'subject',
] as const;
export type ParticipantRole = (typeof PARTICIPANT_ROLES)[number];

export const ParticipantSchema = z.strictObject({
  id: zId('participant'),
  segmentId: zId('segment'),
  personId: zId('person'),
  side: z.number().int().min(0).max(MAX_SIDE),
  role: z.enum(PARTICIPANT_ROLES),
  /** The team this person is representing in the segment, if any. */
  teamId: zId('team').nullable(),
  /** Order of entry (1 first) for battle royals and similar; null when it does not matter. */
  entranceOrder: zPositiveInt.nullable(),
  /** Order of elimination (1 first out) for multi-person matches; null when not eliminated. */
  eliminationOrder: zPositiveInt.nullable(),
});

export type Participant = z.infer<typeof ParticipantSchema>;

export const participantsTable = defineTable({
  kind: 'participant',
  name: 'participants',
  schema: ParticipantSchema,
  refs: [
    { path: 'segmentId', target: 'segment', nullable: false },
    { path: 'personId', target: 'person', nullable: false },
    { path: 'teamId', target: 'team', nullable: true },
  ],
  indexes: [
    { name: 'bySegment', key: (participant) => participant.segmentId },
    { name: 'byPerson', key: (participant) => participant.personId },
    {
      name: 'bySegmentPerson',
      key: (participant) => `${participant.segmentId}|${participant.personId}`,
      unique: true,
    },
  ],
});
