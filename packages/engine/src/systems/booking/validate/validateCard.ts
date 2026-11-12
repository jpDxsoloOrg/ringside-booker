/**
 * `validateCard`: everything wrong with a show's card, in one answer the booking screen, the lock
 * command and the rival booker (AIP4) all share.
 *
 * Every registered booking check runs against the card. Errors block locking; warnings never do.
 * Issues are sorted by where they are (card-wide first, then the pre-show, then the main card, each
 * by slot), then by the order of the check that found them. The checklist always lists EVT2's
 * seven lines in a fixed order, then one line for each other check that found something.
 *
 * Design notes: docs/design/booking.md#validation.
 */

import type { GameDate } from '../../../core/date';
import { InvalidArgumentError } from '../../../core/errors';
import type { EventInstanceId, SegmentId } from '../../../core/ids';
import type { Participant } from '../../../model/entities/participant';
import { compareIds } from '../../../model/table';
import type { GameWorldView } from '../../../model/tables';
import type { DeepReadonly } from '../../../model/world';
import type { EngineTunables } from '../../tunables';
import { cardSegments } from '../card';
import { minFilledMainSlots } from '../formulas/minFilledMainSlots';
import {
  CARD_WIDE_CHECK_ID,
  PEOPLE_CHECK_ID,
  STRUCTURE_CHECK_ID,
  TITLES_CHECK_ID,
  WARNINGS_CHECK_ID,
} from './checks';
import { runBookingChecks, type CheckRun } from './registry';
import type { BookingCheckInput, BookingIssue, BookingValidation, ChecklistItem } from './types';

export interface ValidateCardDeps {
  readonly tunables: EngineTunables;
  /** The day the card is checked on; defaults to the world's current date. */
  readonly today?: GameDate;
}

const BUILT_IN_CHECK_IDS: ReadonlySet<string> = new Set([
  PEOPLE_CHECK_ID,
  CARD_WIDE_CHECK_ID,
  STRUCTURE_CHECK_ID,
  TITLES_CHECK_ID,
  WARNINGS_CHECK_ID,
]);

/** The fixed checklist lines and the built-in codes each gathers. */
const CHECKLIST_LINES: readonly { id: string; label: string; codes: readonly string[] }[] = [
  { id: 'mainCardFilled', label: 'Main card filled', codes: ['tooFewFilled'] },
  { id: 'mainEvent', label: 'Main event booked', codes: ['emptyMainEvent'] },
  { id: 'results', label: 'Every match has a result', codes: ['noPlannedResult'] },
  {
    id: 'available',
    label: 'Everyone is available',
    codes: [
      'personUnavailable',
      'notOnRoster',
      'notAWrestler',
      'injuredTalking',
      'appearanceCap',
      'noHouseShows',
      'otherBrand',
    ],
  },
  {
    id: 'notTwice',
    label: 'Nobody is booked twice',
    codes: ['alreadyOnCard', 'tooManyAppearances'],
  },
  {
    id: 'sides',
    label: 'Sides fit their match types',
    codes: ['sideCount', 'sideSize', 'unequalSides', 'speakerCount'],
  },
  {
    id: 'titles',
    label: 'Title matches are set up correctly',
    codes: [
      'titleNotAllowed',
      'titleTwiceOnCard',
      'titleRetired',
      'championMissing',
      'titleSideSize',
      'titleOtherBrand',
      'titleDivision',
    ],
  },
];

/** The checklist line a built-in issue belongs to, or undefined for any other check's issue. */
function builtInLineOf(issue: BookingIssue): string | undefined {
  if (!BUILT_IN_CHECK_IDS.has(issue.checkId)) {
    return undefined;
  }
  return CHECKLIST_LINES.find((line) => line.codes.includes(issue.code))?.id;
}

function sectionRank(issue: BookingIssue): number {
  if (issue.slot === undefined) {
    return 0;
  }
  return issue.slot.preShow ? 1 : 2;
}

interface Found {
  readonly issue: BookingIssue;
  readonly checkRank: number;
  readonly index: number;
}

function compareFound(left: Found, right: Found): number {
  return (
    sectionRank(left.issue) - sectionRank(right.issue) ||
    (left.issue.slot?.slot ?? -1) - (right.issue.slot?.slot ?? -1) ||
    left.checkRank - right.checkRank ||
    left.index - right.index
  );
}

function participantsBySegment(
  read: GameWorldView,
  segmentIds: readonly SegmentId[],
): Map<SegmentId, DeepReadonly<Participant>[]> {
  return new Map(
    segmentIds.map((segmentId) => [
      segmentId,
      [...read.tables.participants.lookup('bySegment', segmentId)].sort(
        (left, right) => left.side - right.side || compareIds(left.personId, right.personId),
      ),
    ]),
  );
}

/** The line's state from its issues: passes with none; an error makes it an error line. */
function lineOf(id: string, label: string, issues: readonly BookingIssue[]): ChecklistItem {
  const [first] = issues;
  if (first === undefined) {
    return { id, label, passed: true, severity: 'error' };
  }
  const severity = issues.some((issue) => issue.severity === 'error') ? 'error' : 'warning';
  const lead = issues.find((issue) => issue.severity === severity) ?? first;
  const more = issues.length - 1;
  return {
    id,
    label,
    passed: false,
    severity,
    detail: more === 0 ? lead.message : `${lead.message} (and ${String(more)} more)`,
  };
}

function checklistOf(
  input: BookingCheckInput,
  sorted: readonly BookingIssue[],
  runs: readonly CheckRun[],
): ChecklistItem[] {
  const { slots } = input.instance.format;
  const filled = new Set(
    input.segments
      .filter((segment) => !segment.preShow && segment.slot < slots)
      .map((segment) => segment.slot),
  ).size;
  const needed = minFilledMainSlots({ slots }, { tunables: input.tunables });

  const items = CHECKLIST_LINES.map((line) => {
    const issues = sorted.filter((issue) => builtInLineOf(issue) === line.id);
    if (line.id !== 'mainCardFilled') {
      return lineOf(line.id, line.label, issues);
    }
    const label = `${line.label} (${String(filled)} of ${String(slots)}, needs ${String(needed.value)})`;
    return { ...lineOf(line.id, label, issues), trace: needed.trace };
  });

  const featureIssues = new Map<string, BookingIssue[]>();
  for (const issue of sorted) {
    if (builtInLineOf(issue) !== undefined) {
      continue;
    }
    featureIssues.set(issue.checkId, [...(featureIssues.get(issue.checkId) ?? []), issue]);
  }
  for (const run of runs) {
    const issues = featureIssues.get(run.check.id);
    if (issues !== undefined) {
      items.push(lineOf(run.check.id, run.check.label ?? run.check.id, issues));
    }
  }
  return items;
}

/**
 * Validates the card of `eventInstanceId` against every registered booking check. Throws
 * `InvalidArgumentError` for an unknown show; callers look the show up first. Who may see the
 * answer is the caller's question.
 */
export function validateCard(
  read: GameWorldView,
  eventInstanceId: EventInstanceId,
  deps: ValidateCardDeps,
): BookingValidation {
  const instance = read.tables.eventInstances.get(eventInstanceId);
  if (instance === undefined) {
    throw new InvalidArgumentError('validateCard', 'eventInstanceId', eventInstanceId, 'a show');
  }
  const segments = cardSegments(read, instance.id);
  const input: BookingCheckInput = {
    read,
    instance,
    segments,
    participantsBySegment: participantsBySegment(
      read,
      segments.map((segment) => segment.id),
    ),
    today: deps.today ?? read.meta.currentDate,
    tunables: deps.tunables,
  };
  const runs = runBookingChecks(input);
  const sorted = runs
    .flatMap((run, checkRank) =>
      run.issues.map((issue, index): Found => ({ issue, checkRank, index })),
    )
    .sort(compareFound)
    .map((found) => found.issue);
  const errors = sorted.filter((issue) => issue.severity === 'error');
  const warnings = sorted.filter((issue) => issue.severity === 'warning');
  return {
    errors,
    warnings,
    runnable: errors.length === 0,
    checklist: checklistOf(input, sorted, runs),
  };
}
