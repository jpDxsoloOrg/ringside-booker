/**
 * Who's who and where in talking segments (MTCH5-08): warnings only, never errors, so the booker can
 * still put anyone anywhere.
 *
 * - `angle.wrongRole`: someone plays a part their beat group isn't for (a wrestler as an
 *   interview's Host);
 * - `angle.settingNotAllowed` / `angle.beatSettingNotAllowed`: the angle type or a beat can't happen
 *   in the chosen setting;
 * - `angle.clientNotInSegment`: a manager is booked for a client who isn't in the segment.
 *
 * The rules are MTCH5-08's `talkWarnings` (`systems/match/angles/talkWarnings.ts`); this check
 * reads them off each stored angle on the card. Design notes: docs/design/booking.md#validation.
 */

import type { PersonId } from '../../../../core/ids';
import { angleTypeOf, beatOf, hasBeatCatalog } from '../../../../model/catalogs';
import { settingOf } from '../../../../model/entities/segment';
import { beatGroupsOf } from '../../../match/angles/beatGroups';
import { talkRoleForEmployment } from '../../../match/angles/settings';
import { talkWarnings, type TalkPart } from '../../../match/angles/talkWarnings';
import type { BookingCheck, BookingCheckInput, BookingIssueDraft } from '../types';
import { at, nameOf, participantsOf, rosterFor } from './shared';

export const TALK_CHECK_ID = 'booking.talk';
export const TALK_CHECK_ORDER = 200;
export const TALK_CHECK_LABEL = 'Talking segments: who plays which part, and where';

function talkIssues(input: BookingCheckInput): BookingIssueDraft[] {
  const { read } = input;
  if (!hasBeatCatalog(read)) {
    return [];
  }
  const issues: BookingIssueDraft[] = [];
  for (const segment of input.segments) {
    if (segment.kind !== 'angle') {
      continue;
    }
    const angleType = angleTypeOf(read, segment.angle.angleTypeKey);
    if (angleType === undefined) {
      continue;
    }
    const participants = participantsOf(input, segment);
    const sideOf = new Map<PersonId, number>();
    const parts = new Map<PersonId, TalkPart>();
    for (const participant of participants) {
      if (participant.role !== 'speaker') {
        continue;
      }
      // A speaker who names no part plays the one they were hired for (saves before MTCH5-08).
      const hiredAs = rosterFor(input).get(participant.personId)?.role;
      const role =
        participant.talkRole ??
        (hiredAs === undefined ? 'wrestler' : talkRoleForEmployment(hiredAs));
      sideOf.set(participant.personId, participant.side);
      parts.set(participant.personId, {
        talkRole: role,
        ...(participant.forPersonId === undefined ? {} : { forPersonId: participant.forPersonId }),
      });
    }
    const beats = segment.angle.beats.map((beat) =>
      beatGroupsOf(beat, beatOf(read, beat.beatKey) ?? { groups: [] }, (personId) =>
        sideOf.get(personId),
      ),
    );
    const warnings = talkWarnings({
      angleType,
      setting: settingOf(segment),
      beats,
      parts,
      beatOf: (beatKey) => beatOf(read, beatKey),
      nameOf: (personId) => nameOf(input, personId),
    });
    for (const warning of warnings) {
      issues.push({
        code: warning.code,
        severity: 'warning',
        message: warning.message,
        ...at(segment),
        ...(warning.personId === undefined ? {} : { personId: warning.personId }),
      });
    }
  }
  return issues;
}

export const talkCheck: BookingCheck = {
  id: TALK_CHECK_ID,
  order: TALK_CHECK_ORDER,
  label: TALK_CHECK_LABEL,
  run: talkIssues,
};
