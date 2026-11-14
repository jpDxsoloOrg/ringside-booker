/**
 * MTCH5's booking checks (MTCH5-06): a talking segment's beats must fit its slot, and its beats are
 * held to MTCH5-03's angle warnings. Both plug into booking through `registerBookingCheck`, so
 * booking's own files do not change.
 *
 * - `match.angleBeatLimit` (error): more beats than the slot allows, for example "Pre-show: short
 *   slot, up to 2 beats. Remove a beat or move this angle." The slot is read from where the
 *   segment sits now, so a reorder that drags a 4-beat angle into the pre-show is caught.
 * - `match.angleWarnings`: `angle.sidesConflict` is an error; `angle.injuredInPhysicalBeat` and
 *   `angle.groupTooBig` are warnings. `angle.cannotWorkAngles` and `angle.unavailable` (errors) are
 *   reported only for people in a beat who are not booked on the segment: booking's own people
 *   check already reports everyone who is (`personUnavailable`), and the card should not say it
 *   twice. The other `angle.*` codes are either the beat limit above or booking's talk check.
 *
 * A save without a beat catalog is not checked (its angles keep their one default beat).
 *
 * Design: docs/design/angle-rating.md#booking and docs/design/booking.md#validation.
 */

import type { PersonId } from '../../../core/ids';
import { angleTypeOf, hasBeatCatalog } from '../../../model/catalogs';
import { settingOf, type Segment } from '../../../model/entities/segment';
import type { DeepReadonly } from '../../../model/world';
import { registerBookingCheck } from '../../booking/validate/registry';
import {
  at,
  nameOf,
  participantsOf,
  placeOf,
  rosterFor,
} from '../../booking/validate/checks/shared';
import type {
  BookingCheck,
  BookingCheckInput,
  BookingIssueDraft,
} from '../../booking/validate/types';
import { availabilityOf } from '../../workers/helpers/availability';
import { availabilityText } from '../availabilityText';
import { ratingInputFromSegment } from '../rating/fromSegment';
import { slotRoleOf, type DurationClass, type SlotRole } from '../slots';
import { beatLimitMessage, beatLimitOf } from './beatLimit';
import { angleBeatWarnings } from './angleWarnings';
import { angleDurationClass } from './rateAngle';

export const ANGLE_BEAT_LIMIT_CHECK_ID = 'match.angleBeatLimit';
export const ANGLE_BEAT_LIMIT_CHECK_ORDER = 230;
export const ANGLE_BEAT_LIMIT_CHECK_LABEL = 'Talking segments fit their slots';

export const ANGLE_WARNINGS_CHECK_ID = 'match.angleWarnings';
export const ANGLE_WARNINGS_CHECK_ORDER = 240;
export const ANGLE_WARNINGS_CHECK_LABEL = "Talking segments' beats";

/** The code of the beat limit error. */
export const ANGLE_BEAT_LIMIT_CODE = 'angle.tooManyBeats';

/** The `angle.*` codes `match.angleWarnings` reports, and how hard. */
export const ANGLE_CHECK_SEVERITIES = {
  'angle.sidesConflict': 'error',
  'angle.cannotWorkAngles': 'error',
  'angle.unavailable': 'error',
  'angle.injuredInPhysicalBeat': 'warning',
  'angle.groupTooBig': 'warning',
} as const;

type MappedCode = keyof typeof ANGLE_CHECK_SEVERITIES;

function isMappedCode(code: string): code is MappedCode {
  return Object.hasOwn(ANGLE_CHECK_SEVERITIES, code);
}

/** The slot role of a segment where it sits on the card now. */
function roleOf(input: BookingCheckInput, segment: DeepReadonly<Segment>): SlotRole | null {
  const { slots } = input.instance.format;
  if (!segment.preShow && segment.slot >= slots) {
    return null;
  }
  return slotRoleOf(
    { slot: segment.slot + 1, slots, preShow: segment.preShow },
    { tunables: input.tunables },
  ).value;
}

/** A talking segment's duration class where it sits, moved by its setting (MTCH5-08). */
function durationClassAt(
  input: BookingCheckInput,
  segment: DeepReadonly<Segment>,
): DurationClass | null {
  const role = roleOf(input, segment);
  return role === null ? null : angleDurationClass(role, settingOf(segment), input.tunables);
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/**
 * "Pre-show: short slot, up to 2 beats. Remove a beat or move this angle." The error a card shows
 * for an angle with more beats than its slot allows.
 */
export function angleBeatLimitText(place: string, limitMessage: string, over: number): string {
  const remove = over === 1 ? 'a beat' : `${String(over)} beats`;
  // "Short slot: up to 2 beats" reads "short slot, up to 2 beats" after the place.
  const limit = lowerFirst(limitMessage).replace(': ', ', ');
  return `${place}: ${limit}. Remove ${remove} or move this angle.`;
}

function beatLimitIssues(input: BookingCheckInput): BookingIssueDraft[] {
  if (!hasBeatCatalog(input.read)) {
    return [];
  }
  const issues: BookingIssueDraft[] = [];
  for (const segment of input.segments) {
    if (segment.kind !== 'angle') {
      continue;
    }
    const durationClass = durationClassAt(input, segment);
    if (durationClass === null) {
      continue;
    }
    const max = beatLimitOf(durationClass, input.tunables).value;
    const count = segment.angle.beats.length;
    if (count > max) {
      issues.push({
        code: ANGLE_BEAT_LIMIT_CODE,
        severity: 'error',
        message: angleBeatLimitText(
          placeOf(input, segment),
          beatLimitMessage(durationClass, max),
          count - max,
        ),
        ...at(segment),
      });
    }
  }
  return issues;
}

/** People in a beat who aren't booked on the segment and can't appear on the show's date. */
function beatOnlyPeopleIssues(
  input: BookingCheckInput,
  segment: DeepReadonly<Extract<Segment, { kind: 'angle' }>>,
): BookingIssueDraft[] {
  const booked = new Set(participantsOf(input, segment).map((participant) => participant.personId));
  const issues: BookingIssueDraft[] = [];
  const seen = new Set<PersonId>();
  for (const beat of segment.angle.beats) {
    for (const personId of beat.personIds) {
      if (booked.has(personId) || seen.has(personId)) {
        continue;
      }
      seen.add(personId);
      const person = input.read.tables.people.get(personId);
      if (person === undefined) {
        continue;
      }
      const availability = availabilityOf(
        person,
        rosterFor(input).get(personId) ?? null,
        input.instance.date,
      );
      if (availability.status === 'available' || availability.canWorkAngles) {
        continue;
      }
      const code: MappedCode =
        availability.status === 'injured' ? 'angle.cannotWorkAngles' : 'angle.unavailable';
      issues.push({
        code,
        severity: ANGLE_CHECK_SEVERITIES[code],
        message: `${nameOf(input, personId)} can't appear: ${availabilityText(availability, input.today)}`,
        personId,
        ...at(segment),
      });
    }
  }
  return issues;
}

function angleWarningIssues(input: BookingCheckInput): BookingIssueDraft[] {
  const { read } = input;
  if (!hasBeatCatalog(read)) {
    return [];
  }
  const issues: BookingIssueDraft[] = [];
  for (const segment of input.segments) {
    if (segment.kind !== 'angle' || angleTypeOf(read, segment.angle.angleTypeKey) === undefined) {
      continue;
    }
    const durationClass = durationClassAt(input, segment);
    if (durationClass === null) {
      continue;
    }
    // The stored beats split into groups by the participants' sides, as the rater reads them.
    const ratingInput = ratingInputFromSegment(read, segment.id);
    const warnings = angleBeatWarnings(ratingInput, ratingInput.angle?.beats ?? [], {
      read,
      date: input.instance.date,
      tunables: input.tunables,
      durationClass,
      nameOf: (personId) => nameOf(input, personId),
      availabilityOf: (personId) => {
        const person = read.tables.people.get(personId);
        return person === undefined
          ? null
          : availabilityOf(person, rosterFor(input).get(personId) ?? null, input.instance.date);
      },
    });
    for (const warning of warnings) {
      if (!isMappedCode(warning.code)) {
        continue;
      }
      issues.push({
        code: warning.code,
        severity: ANGLE_CHECK_SEVERITIES[warning.code],
        message: `${placeOf(input, segment)}: ${warning.message}`,
        ...(warning.personId === undefined ? {} : { personId: warning.personId }),
        ...at(segment),
      });
    }
    issues.push(...beatOnlyPeopleIssues(input, segment));
  }
  return issues;
}

export const angleBeatLimitCheck: BookingCheck = {
  id: ANGLE_BEAT_LIMIT_CHECK_ID,
  order: ANGLE_BEAT_LIMIT_CHECK_ORDER,
  label: ANGLE_BEAT_LIMIT_CHECK_LABEL,
  run: beatLimitIssues,
};

export const angleWarningsCheck: BookingCheck = {
  id: ANGLE_WARNINGS_CHECK_ID,
  order: ANGLE_WARNINGS_CHECK_ORDER,
  label: ANGLE_WARNINGS_CHECK_LABEL,
  run: angleWarningIssues,
};

registerBookingCheck(angleBeatLimitCheck);
registerBookingCheck(angleWarningsCheck);
