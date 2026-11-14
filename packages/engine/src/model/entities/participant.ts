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
import { DEFAULT_TALK_ROLE, TALK_ROLES, type TalkRole } from './angle-setting';

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
 *
 * A speaker may also say what part they play (`talkRole`, MTCH5-08): a wrestler, a manager for a
 * client (`forPersonId`), an interviewer or an authority figure. A speaker without one is a
 * wrestler, so saves from before MTCH5-08 read the same.
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
  /** MTCH5-08: the part a speaker plays in a talking segment. Absent = `wrestler`. */
  talkRole: z.enum(TALK_ROLES).optional(),
  /** MTCH5-08: the client a manager speaks for or stands with. Only with `talkRole: 'manager'`. */
  forPersonId: zId('person').optional(),
});

export type Participant = z.infer<typeof ParticipantSchema>;

/**
 * The part a person plays in a talking segment: their stored `talkRole`, or `wrestler` for a
 * speaker who names none (saves from before MTCH5-08). Null for a role that does not talk
 * (competitors, ringside, interferers and subjects).
 */
export function talkRoleOf(participant: {
  readonly role: ParticipantRole;
  readonly talkRole?: TalkRole | undefined;
}): TalkRole | null {
  return participant.role === 'speaker' ? (participant.talkRole ?? DEFAULT_TALK_ROLE) : null;
}

export const participantsTable = defineTable({
  kind: 'participant',
  name: 'participants',
  schema: ParticipantSchema,
  refs: [
    { path: 'segmentId', target: 'segment', nullable: false },
    { path: 'personId', target: 'person', nullable: false },
    { path: 'teamId', target: 'team', nullable: true },
    { path: 'forPersonId', target: 'person', nullable: true },
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
