/**
 * Who did what and where, in one line (MTCH5-08): "Backstage: Lena Park interviews Kai Moreno (with
 * Victor Crane)". The booking card, the results page and live show night read this one line.
 *
 * - Interviewers interview everyone else; with no interviewer, an authority figure meets them.
 * - A manager whose client is in the segment is "with" them; one without their client is listed
 *   like anyone else.
 * - Backstage and pre-taped segments start with the setting. A ring segment with nobody but
 *   wrestlers gets no line (the card's names already say it).
 *
 * A speaker with no stored part plays the one they were hired for (saves from before MTCH5-08).
 *
 * Design: docs/design/angle-rating.md#talk-roles.
 */

import type { PersonId } from '../../../core/ids';
import type { Employment } from '../../../model/entities/employment';
import type { AngleSetting, TalkRole } from '../../../model/entities/angle-setting';
import type { Participant } from '../../../model/entities/participant';
import { settingOf, type Segment } from '../../../model/entities/segment';
import { compareIds } from '../../../model/table';
import type { GameWorldView } from '../../../model/tables';
import type { DeepReadonly } from '../../../model/world';
import { settingLabel, talkRoleForEmployment } from './settings';

/** One person in the line. */
export interface TalkLinePerson {
  readonly personId: PersonId;
  readonly name: string;
  readonly talkRole: TalkRole;
  readonly forPersonId?: PersonId | undefined;
}

/** "Kai Moreno", "Kai Moreno and Rex Hale", "A, B and C". */
function and(names: readonly string[]): string {
  if (names.length <= 1) {
    return names[0] ?? '';
  }
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] ?? ''}`;
}

/** The line for `people` in `setting`, or null for a ring segment of wrestlers only. */
export function talkLine(setting: AngleSetting, people: readonly TalkLinePerson[]): string | null {
  const present = new Set(people.map((person) => person.personId));
  const withClient = (person: TalkLinePerson): boolean =>
    person.talkRole === 'manager' &&
    person.forPersonId !== undefined &&
    person.forPersonId !== person.personId &&
    present.has(person.forPersonId);
  const interviewers = people.filter((person) => person.talkRole === 'interviewer');
  const authorities = people.filter((person) => person.talkRole === 'authority');
  const withs = people.filter(withClient);
  const leads = interviewers.length > 0 ? interviewers : authorities;
  const others = people.filter((person) => !leads.includes(person) && !withs.includes(person));
  const names = (list: readonly TalkLinePerson[]): string =>
    and(list.map((person) => person.name));

  if (setting === 'ring' && leads.length === 0 && withs.length === 0) {
    return null;
  }
  let core: string;
  if (leads.length === 0) {
    core = names(others);
  } else if (others.length === 0) {
    core = names(leads);
  } else {
    const plural = leads.length > 1;
    const verb =
      interviewers.length > 0 ? (plural ? 'interview' : 'interviews') : plural ? 'meet' : 'meets';
    core = `${names(leads)} ${verb} ${names(others)}`;
  }
  if (withs.length > 0) {
    core = core === '' ? names(withs) : `${core} (with ${names(withs)})`;
  }
  return setting === 'ring' ? core : `${settingLabel(setting)}: ${core}`;
}

/** A speaker's part: the stored one, or the one they were hired for, else a wrestler. */
export function talkRoleWithFallback(
  participant: Pick<DeepReadonly<Participant>, 'talkRole'>,
  hired: Pick<DeepReadonly<Employment>, 'role'> | undefined,
): TalkRole {
  return participant.talkRole ?? (hired === undefined ? 'wrestler' : talkRoleForEmployment(hired.role));
}

/**
 * The line for a stored segment: its speakers in side then id order, with their parts. Null for a
 * match, and for a ring segment of wrestlers only.
 */
export function talkLineOf(
  read: GameWorldView,
  segment: DeepReadonly<Segment>,
  people: {
    readonly roster: ReadonlyMap<PersonId, DeepReadonly<Employment>>;
    ringName(personId: PersonId): string;
  },
): string | null {
  if (segment.kind !== 'angle') {
    return null;
  }
  const speakers = read.tables.participants
    .lookup('bySegment', segment.id)
    .filter((participant) => participant.role === 'speaker')
    .sort((left, right) => left.side - right.side || compareIds(left.personId, right.personId));
  return talkLine(
    settingOf(segment),
    speakers.map((participant) => ({
      personId: participant.personId,
      name: people.ringName(participant.personId),
      talkRole: talkRoleWithFallback(participant, people.roster.get(participant.personId)),
      ...(participant.forPersonId === undefined ? {} : { forPersonId: participant.forPersonId }),
    })),
  );
}
