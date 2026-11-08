/**
 * Placeholder calculation traces for the "Why?" panel demo and tests. The numbers are made up and
 * the shapes follow docs/design/calculation-traces.md: each formula's steps replay to its value.
 * Cards are slot-based (D-10), so the match rating talks about the slot role and duration class
 * ("Main event (long)"), never minutes.
 */
import { parseGameDate } from '@ringside/engine';
import type { StoredTrace, TraceNode, TraceRef, TraceSummary } from '@ringside/engine';

/** A fictional attendance figure: venue size, popularity, two modifiers, a roll and a clamp. */
export const attendanceTrace: TraceNode = {
  kind: 'formula',
  label: 'Attendance',
  value: 9000,
  unit: 'count',
  children: [
    {
      kind: 'input',
      label: 'Venue size',
      value: 9000,
      unit: 'count',
      ref: { kind: 'venue', id: 'ven_gallery_hall' },
    },
    {
      kind: 'multiply',
      label: 'Promotion popularity',
      value: 7560,
      unit: 'count',
      operand: 0.84,
      before: 9000,
      after: 7560,
      reason: 'Share of the venue a promotion this popular fills',
      children: [
        {
          kind: 'input',
          label: 'Popularity of the promotion in the region',
          value: 84,
          unit: 'percent',
          ref: { kind: 'promotion', id: 'pro_gallery' },
        },
        {
          kind: 'constant',
          label: 'Percent scale',
          value: 100,
          reason: 'percentages are stored as 0 to 100',
        },
      ],
    },
    {
      kind: 'add',
      label: 'Show hype',
      value: 8460,
      unit: 'count',
      operand: 900,
      before: 7560,
      after: 8460,
      reason: 'Card announced two weeks out',
      children: [
        { kind: 'input', label: 'Hype for this show', value: 60, unit: 'points' },
        {
          kind: 'tunable',
          label: 'Fans per hype point',
          key: 'attendance.hypeFans',
          value: 15,
          defaultValue: 12,
          overridden: true,
          unit: 'count',
        },
      ],
    },
    {
      kind: 'multiply',
      label: 'Weekend show',
      value: 9306,
      unit: 'count',
      operand: 1.1,
      before: 8460,
      after: 9306,
      reason: 'Saturday night crowd',
    },
    {
      kind: 'roll',
      label: 'Walk-up crowd',
      value: 212,
      roll: {
        stream: 'attendance.walkUp',
        kind: 'int',
        label: 'Walk-up crowd',
        odds: 1 / 1001,
        min: -500,
        max: 500,
        result: 212,
      },
      children: [
        {
          kind: 'tunable',
          label: 'Largest walk-up swing',
          key: 'attendance.walkUpSwing',
          value: 500,
          defaultValue: 500,
          overridden: false,
          unit: 'count',
        },
      ],
    },
    {
      kind: 'add',
      label: 'Walk-up crowd',
      value: 9518,
      unit: 'count',
      operand: 212,
      before: 9306,
      after: 9518,
    },
    {
      kind: 'max',
      label: 'No negative crowd',
      value: 9518,
      unit: 'count',
      limit: 0,
      before: 9518,
      after: 9518,
      applied: false,
    },
    {
      kind: 'clamp',
      label: 'Kept between 0 and the venue size',
      value: 9000,
      unit: 'count',
      min: 0,
      max: 9000,
      before: 9518,
      after: 9000,
      applied: true,
    },
  ],
};

/** The slot this match filled: its role and duration class, as D-10 names them. */
const SLOT_LABEL = 'Main event (long)';

/** A match-rating style tree with three nested calculations. */
export const matchRatingTrace: TraceNode = {
  kind: 'formula',
  label: 'Match rating',
  value: 71,
  unit: 'points',
  children: [
    {
      kind: 'formula',
      label: 'Work rate',
      value: 68,
      unit: 'points',
      children: [
        { kind: 'input', label: 'Average ring skill', value: 70, unit: 'points' },
        { kind: 'input', label: 'Slot', value: SLOT_LABEL },
        {
          kind: 'branch',
          label: `${SLOT_LABEL} tests stamina and ring psychology`,
          value: true,
          condition: `${SLOT_LABEL} tests stamina and ring psychology`,
          taken: true,
        },
        {
          kind: 'subtract',
          label: 'Stamina check failed for Worker 7',
          value: 64,
          unit: 'points',
          operand: 6,
          before: 70,
          after: 64,
          reason: SLOT_LABEL,
          children: [
            {
              kind: 'input',
              label: 'Stamina of Worker 7',
              value: 41,
              unit: 'points',
              ref: { kind: 'person', id: 'per_gallery_07' },
            },
            {
              kind: 'roll',
              label: 'Stamina check',
              value: false,
              roll: {
                stream: 'match.stamina',
                kind: 'chance',
                label: 'Stamina check',
                odds: 0.35,
                result: false,
              },
            },
          ],
        },
        {
          kind: 'multiply',
          label: 'Chemistry',
          value: 68,
          unit: 'points',
          operand: 1.0625,
          before: 64,
          after: 68,
          reason: 'Have wrestled each other often',
        },
        {
          kind: 'branch',
          label: 'Title match',
          value: false,
          condition: 'Title match',
          taken: false,
        },
      ],
    },
    {
      kind: 'add',
      label: 'Crowd reaction',
      value: 80,
      unit: 'points',
      operand: 12,
      before: 68,
      after: 80,
      children: [
        {
          kind: 'formula',
          label: 'Crowd reaction',
          value: 12,
          unit: 'points',
          children: [
            { kind: 'input', label: 'Performance', value: 68, unit: 'points' },
            {
              kind: 'subtract',
              label: 'Expected from these workers',
              value: 7,
              unit: 'points',
              operand: 61,
              before: 68,
              after: 7,
            },
            {
              kind: 'add',
              label: 'Hometown crowd',
              value: 12,
              unit: 'points',
              operand: 5,
              before: 7,
              after: 12,
              reason: 'Show is in their home region',
            },
            {
              kind: 'clamp',
              label: 'Kept between −20 and 20',
              value: 12,
              unit: 'points',
              min: -20,
              max: 20,
              before: 12,
              after: 12,
              applied: false,
            },
          ],
        },
      ],
    },
    {
      kind: 'multiply',
      label: 'Card position',
      value: 70.8,
      unit: 'points',
      operand: 0.885,
      before: 80,
      after: 70.8,
      reason: `${SLOT_LABEL}: the crowd expects more`,
      children: [
        {
          kind: 'formula',
          label: 'Card position weight',
          value: 0.885,
          unit: 'ratio',
          children: [
            { kind: 'input', label: 'Base weight', value: 1, unit: 'ratio' },
            {
              kind: 'subtract',
              label: SLOT_LABEL,
              value: 0.885,
              unit: 'ratio',
              operand: 0.115,
              before: 1,
              after: 0.885,
              reason: 'The last slot is judged hardest',
              children: [
                {
                  kind: 'tunable',
                  label: 'Main event expectation',
                  key: 'matches.mainEventExpectation',
                  value: 0.115,
                  defaultValue: 0.1,
                  overridden: true,
                  unit: 'ratio',
                },
              ],
            },
          ],
        },
      ],
    },
    {
      kind: 'round',
      label: 'Rounded',
      value: 71,
      unit: 'points',
      mode: 'round',
      before: 70.8,
      after: 71,
    },
    {
      kind: 'clamp',
      label: 'Kept between 0 and 100',
      value: 71,
      unit: 'points',
      min: 0,
      max: 100,
      before: 71,
      after: 71,
      applied: false,
      children: [
        {
          kind: 'constant',
          label: 'Highest rating',
          value: 100,
          reason: 'ratings run from 0 to 100',
        },
      ],
    },
    { kind: 'note', label: 'Taped for television', value: null },
  ],
};

/** Where the gallery's recent attendance trace is filed. */
export const RECENT_ATTENDANCE_REF: TraceRef = {
  kind: 'show.attendance',
  id: 'evi_gallery_recent',
};

/** Where the gallery's older, summarised attendance is filed. */
export const OLDER_ATTENDANCE_REF: TraceRef = { kind: 'show.attendance', id: 'evi_gallery_old' };

/** The attendance trace as the engine's trace store keeps a recent result. */
export const recentAttendanceEntry: StoredTrace = {
  ref: RECENT_ATTENDANCE_REF,
  date: parseGameDate('2031-03-14'),
  seq: 2,
  trace: attendanceTrace,
  value: 9000,
};

/** An older attendance whose full breakdown has been summarised. */
export const summarisedAttendance: TraceSummary = {
  ref: OLDER_ATTENDANCE_REF,
  date: parseGameDate('2031-02-08'),
  seq: 1,
  label: 'Attendance',
  value: 6400,
  unit: 'count',
  topContributors: [
    { label: 'Promotion popularity', effect: -2100 },
    { label: 'Show hype', effect: 700 },
    { label: 'Walk-up crowd', effect: -150 },
  ],
};
