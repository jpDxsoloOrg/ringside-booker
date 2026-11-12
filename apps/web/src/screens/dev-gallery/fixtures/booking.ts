/**
 * Static booking cards for the gallery: the board and the checklist drawn from the same shapes
 * `booking.card` and `booking.validate` return, with no engine behind them.
 */
import { parseContentKey, parseId } from '@ringside/engine';
import type {
  BookingIssue,
  BookingResultView,
  BookingSectionView,
  BookingSegmentView,
  BookingSlotView,
  BookingValidation,
  SlotRole,
  TraceNode,
} from '@ringside/engine';
import { galleryPeople } from '../imageSlotFixtures';

const ROLE_LABELS: Readonly<Record<SlotRole, string>> = {
  preShow: 'Pre-show',
  opener: 'Opener',
  midcard: 'Midcard',
  semiMain: 'Semi-main',
  mainEvent: 'Main event',
};

const MAIN_ROLES: readonly SlotRole[] = [
  'opener',
  'midcard',
  'midcard',
  'midcard',
  'semiMain',
  'mainEvent',
];

function roleTrace(role: SlotRole, slot: number): TraceNode {
  return {
    kind: 'decision',
    label: 'Slot role',
    value: ROLE_LABELS[role],
    chosen: ROLE_LABELS[role],
    reason: `Slot ${String(slot)} of 6 on the main card`,
    considered: [],
    children: [
      { kind: 'input', label: 'Slot', value: slot },
      { kind: 'input', label: 'Main card slots', value: 6 },
    ],
  };
}

function sizeTrace(label: string): TraceNode {
  return {
    kind: 'decision',
    label: 'Segment size',
    value: label,
    chosen: label,
    reason: 'The slot role sets the size; some match types move it a step',
    considered: [],
  };
}

function personAt(index: number) {
  const subject = galleryPeople[index % galleryPeople.length];
  const name = subject?.name ?? `Worker ${String(index + 1)}`;
  return {
    personId: parseId('person', `per_${String(index + 1).padStart(10, '0')}`),
    ringName: name,
    imageRef: 'placeholder:person',
    role: 'competitor' as const,
    availability: {
      status: 'available' as const,
      label: 'Available',
      reason: 'Available',
      until: null,
      canWorkAngles: true,
    },
    otherBrand: false,
  };
}

let segmentSerial = 0;

/** A match between single wrestlers: one person a side, starting from `first`. */
export function galleryMatch(
  typeName: string,
  first: number,
  sides: number,
  result: BookingResultView | null,
  titleName?: string,
): BookingSegmentView {
  segmentSerial += 1;
  return {
    segmentId: parseId('segment', `seg_${String(segmentSerial).padStart(10, '0')}`),
    kind: 'match',
    label: null,
    typeKey: 'match.singles',
    typeName,
    durationShiftNote: null,
    titles:
      titleName === undefined
        ? []
        : [
            {
              titleId: parseId('title', 'tit_0000000001'),
              name: titleName,
              holderCount: 1,
              imageRef: 'placeholder:title',
              holderIds: [],
            },
          ],
    sides: Array.from({ length: sides }, (_unused, side) => {
      const person = personAt(first + side);
      return { side, name: person.ringName, teamId: null, people: [person] };
    }),
    result,
    storylineIds: [],
    finishKey: null,
    stipulationKeys: [],
    draft: {
      kind: 'angle',
      label: null,
      storylineIds: [],
      crew: { refereeId: null, producerId: null, announcerIds: [] },
      participants: [],
      angle: { angleTypeKey: parseContentKey('angle.promo') },
    },
  };
}

/** A planned win for side `side`. */
export function galleryWin(side: number): BookingResultView {
  return { kind: 'win', winningSide: side, methodKey: 'method.pinfall', methodName: 'Pinfall' };
}

export const GALLERY_DRAW: BookingResultView = {
  kind: 'draw',
  winningSide: null,
  methodKey: null,
  methodName: null,
};

function slotView(
  preShow: boolean,
  slot: number,
  role: SlotRole,
  segment: BookingSegmentView | null,
): BookingSlotView {
  const durationLabel = role === 'mainEvent' ? 'Long' : role === 'opener' ? 'Short' : 'Standard';
  return {
    slot,
    displayNumber: slot + 1,
    preShow,
    role,
    roleLabel: ROLE_LABELS[role],
    durationClass: role === 'mainEvent' ? 'long' : role === 'opener' ? 'short' : 'standard',
    durationLabel,
    weight: 1,
    roleTrace: roleTrace(role, slot + 1),
    durationTrace: sizeTrace(durationLabel),
    weightTrace: sizeTrace(durationLabel),
    segment,
  };
}

/** A six-slot main card with a pre-show; `filled[n]` goes in main-card slot n (0-based). */
export function galleryCard(
  filled: readonly (BookingSegmentView | null)[],
  preShow: BookingSegmentView | null = null,
): BookingSectionView[] {
  return [
    { preShow: true, slots: [slotView(true, 0, 'preShow', preShow)] },
    {
      preShow: false,
      slots: MAIN_ROLES.map((role, slot) => slotView(false, slot, role, filled[slot] ?? null)),
    },
  ];
}

const FILL_TRACE: TraceNode = {
  kind: 'formula',
  label: 'Main card slots that must be filled',
  value: 3,
  children: [
    { kind: 'input', label: 'Main card slots', value: 6 },
    { kind: 'input', label: 'Share that must be filled', value: 0.5 },
  ],
};

const LINES = [
  ['mainEvent', 'Main event booked'],
  ['results', 'Every match has a result'],
  ['available', 'Everyone is available'],
  ['notTwice', 'Nobody is booked too often'],
  ['sides', 'Sides fit their match types'],
  ['titles', 'Title matches are set up correctly'],
] as const;

/** A validation with these errors and warnings, its checklist lines failing where they apply. */
export function galleryValidation(
  filled: number,
  errors: readonly BookingIssue[],
  warnings: readonly BookingIssue[] = [],
): BookingValidation {
  const failing = (line: string): BookingIssue | undefined =>
    [...errors, ...warnings].find((issue) => issue.checkId === line);
  const fillIssue = failing('mainCardFilled');
  return {
    errors: [...errors],
    warnings: [...warnings],
    runnable: errors.length === 0,
    checklist: [
      {
        id: 'mainCardFilled',
        label: `Main card filled (${String(filled)} of 6, needs 3)`,
        passed: fillIssue === undefined,
        severity: 'error',
        trace: FILL_TRACE,
        ...(fillIssue === undefined ? {} : { detail: fillIssue.message }),
      },
      ...LINES.map(([id, label]) => {
        const issue = failing(id);
        return {
          id,
          label,
          passed: issue === undefined,
          severity: issue?.severity ?? ('error' as const),
          ...(issue === undefined ? {} : { detail: issue.message }),
        };
      }),
    ],
  };
}

/** An issue for the gallery. `checkId` names the checklist line it lands on. */
export function galleryIssue(
  line: string,
  severity: 'error' | 'warning',
  message: string,
  slot?: number,
): BookingIssue {
  return {
    checkId: line,
    code: 'gallery',
    severity,
    message,
    ...(slot === undefined ? {} : { slot: { preShow: false, slot } }),
  };
}
