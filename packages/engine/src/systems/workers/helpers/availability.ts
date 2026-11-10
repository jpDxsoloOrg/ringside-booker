/**
 * Availability: can this person work today, and if not, why not and until when.
 *
 * The answer is worked out from dates on every read. Nothing has to clear an injury, a restriction
 * or a leave when it ends: once its date has passed it simply stops counting.
 *
 * `until` is the first day back. The day's phases run for date D before the world moves on to
 * D + 1, so "`date < until`" means someone whose suspension ends on the 10th can be booked on the
 * 10th.
 *
 * Design: docs/design/workers.md#availability.
 */

import { compareDates, isAfter, isBefore, type GameDate } from '../../../core/date';
import type { Employment } from '../../../model/entities/employment';
import {
  RESTRICTION_KINDS,
  type BodyPart,
  type Person,
  type PersonRole,
  type Restriction,
} from '../../../model/entities/person';

export const AVAILABILITY_STATUSES = [
  'available',
  'injured',
  'rehab',
  'personalLeave',
  'suspended',
  'timeOff',
  'notDebuted',
  'retired',
] as const;
export type AvailabilityStatus = (typeof AVAILABILITY_STATUSES)[number];

/** Whether a person can work on a date. Plain data, safe to hand to a screen. */
export interface Availability {
  status: AvailabilityStatus;
  /** Why, written for the player. */
  reason: string;
  /** The first day back, or null when there is no known end (or nothing to come back from). */
  until: GameDate | null;
  /** True when the person can appear in talking segments on the date. */
  canWorkAngles: boolean;
}

/**
 * The roles a career starts in with a debut. Referees, announcers, presenters and producers have
 * no debut date at all, so a missing date only means "not debuted yet" for someone in these roles.
 */
export const DEBUT_ROLES: readonly PersonRole[] = ['wrestler', 'occasionalWrestler', 'manager'];

const INJURED_PART_TEXT: Readonly<Record<BodyPart, string>> = {
  head: 'head injury',
  neck: 'neck injury',
  back: 'back injury',
  arms: 'arm injury',
  torso: 'torso injury',
  legs: 'leg injury',
};

function unavailable(
  status: AvailabilityStatus,
  reason: string,
  until: GameDate | null,
): Availability {
  return { status, reason, until, canWorkAngles: false };
}

/** The restriction still running on `date` that ends last; ties go to the earlier kind. */
function longestRestriction(
  restrictions: readonly Restriction[],
  date: GameDate,
): Restriction | null {
  let longest: Restriction | null = null;
  for (const restriction of restrictions) {
    if (!isBefore(date, restriction.until)) {
      continue;
    }
    if (longest === null) {
      longest = restriction;
      continue;
    }
    const order = compareDates(restriction.until, longest.until);
    const earlierKind =
      RESTRICTION_KINDS.indexOf(restriction.kind) < RESTRICTION_KINDS.indexOf(longest.kind);
    if (order > 0 || (order === 0 && earlierKind)) {
      longest = restriction;
    }
  }
  return longest;
}

/**
 * The person's availability on `date`. `employment` is the contract the question is asked for (a
 * suspension or time off belongs to one employer), or null for a free agent.
 *
 * The first rule that matches wins:
 *
 * 1. retired, deceased or out of the business → `retired`;
 * 2. a debut still ahead, or no debut date for someone in a role that has one (`DEBUT_ROLES`) →
 *    `notDebuted`;
 * 3. an injury not yet healed → `injured`;
 * 4. a restriction still running → `rehab` or `personalLeave`;
 * 5. on hiatus → `personalLeave`;
 * 6. a leave from the employer still running → `suspended` or `timeOff`;
 * 7. otherwise `available`.
 */
export function availabilityOf(
  person: Pick<Person, 'status' | 'roles' | 'debutDate' | 'injury' | 'restrictions'>,
  employment: Pick<Employment, 'leave'> | null,
  date: GameDate,
): Availability {
  switch (person.status) {
    case 'retired':
      return unavailable('retired', 'Retired', null);
    case 'deceased':
      return unavailable('retired', 'Deceased', null);
    case 'outOfBusiness':
      return unavailable('retired', 'Left the business', null);
    case 'active':
    case 'semiRetired':
    case 'hiatus':
      break;
  }

  if (person.debutDate === null) {
    // Crew roles never get a debut date, so for them a missing date is not a reason to sit out.
    if (person.roles.some((role) => DEBUT_ROLES.includes(role))) {
      return unavailable('notDebuted', 'Has not debuted yet', null);
    }
  } else if (isAfter(person.debutDate, date)) {
    return unavailable('notDebuted', 'Has not debuted yet', person.debutDate);
  }

  const { injury } = person;
  if (injury !== null && isBefore(date, injury.expectedReturn)) {
    const injuryText = `Injured (${INJURED_PART_TEXT[injury.bodyPart]})`;
    return {
      status: 'injured',
      reason: injury.canWorkAngles ? `${injuryText}; can still do talking segments` : injuryText,
      until: injury.expectedReturn,
      canWorkAngles: injury.canWorkAngles,
    };
  }

  const restriction = longestRestriction(person.restrictions, date);
  if (restriction !== null) {
    return restriction.kind === 'rehab'
      ? unavailable('rehab', 'In rehab', restriction.until)
      : unavailable('personalLeave', 'On personal leave', restriction.until);
  }

  if (person.status === 'hiatus') {
    return unavailable('personalLeave', 'On hiatus', null);
  }

  const leave = employment?.leave ?? null;
  if (leave !== null && isBefore(date, leave.until)) {
    return leave.kind === 'suspension'
      ? unavailable('suspended', 'Suspended', leave.until)
      : unavailable('timeOff', 'On time off', leave.until);
  }

  return {
    status: 'available',
    reason: person.status === 'semiRetired' ? 'Semi-retired: works occasional dates' : 'Available',
    until: null,
    canWorkAngles: true,
  };
}
