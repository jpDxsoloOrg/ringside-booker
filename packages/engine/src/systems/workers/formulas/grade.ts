/**
 * Grades: the letter shown next to a 0-100 value.
 *
 * The bands are display labels, not balance numbers, so they are a fixed table and not tunables.
 *
 * Design: docs/design/workers.md#grades.
 */

import { constantOf, type Traced } from '../../../core/trace';

export const GRADES = [
  'F',
  'E',
  'D',
  'C-',
  'C',
  'C+',
  'B-',
  'B',
  'B+',
  'A-',
  'A',
  'A+',
  'S',
] as const;
export type Grade = (typeof GRADES)[number];

/** One grade band. `min` is the lowest value that earns the grade. */
export interface GradeBand {
  readonly grade: Grade;
  readonly min: number;
}

/** The ends of the scale grades are read on. */
const GRADE_SCALE_MIN = 0;
const GRADE_SCALE_MAX = 100;

/** Every band, lowest first. A value earns the last band whose `min` it reaches. */
export const GRADE_BANDS: readonly GradeBand[] = Object.freeze([
  { grade: 'F', min: GRADE_SCALE_MIN },
  { grade: 'E', min: 20 },
  { grade: 'D', min: 30 },
  { grade: 'C-', min: 40 },
  { grade: 'C', min: 47 },
  { grade: 'C+', min: 54 },
  { grade: 'B-', min: 60 },
  { grade: 'B', min: 66 },
  { grade: 'B+', min: 72 },
  { grade: 'A-', min: 78 },
  { grade: 'A', min: 84 },
  { grade: 'A+', min: 90 },
  { grade: 'S', min: 96 },
]);

/** Why the bands are constants and not tunables. */
export const GRADE_BANDS_REASON = 'Display bands for grades';

/** A value's grade with the band it fell in. */
export interface GradeResult {
  grade: Grade;
  /** The lowest whole value in the band. */
  min: number;
  /** The highest whole value in the band. */
  max: number;
  /** Why, written for the player: "72 is in the B+ band, 72 to 77". */
  reason: string;
}

function bandTop(bandIndex: number): number {
  const next = GRADE_BANDS[bandIndex + 1];
  return next === undefined ? GRADE_SCALE_MAX : next.min - 1;
}

/**
 * The grade of a 0-100 value. The value is kept inside 0 to 100 and rounded to the whole number
 * the screen shows before the band is looked up, so the letter always agrees with the number next
 * to it (77.6 is shown as 78 and grades as 78).
 */
export function gradeOf(value: number): GradeResult {
  const clamped = Math.min(GRADE_SCALE_MAX, Math.max(GRADE_SCALE_MIN, value));
  // NaN falls to the bottom of the scale instead of escaping every band.
  const shown = Number.isNaN(clamped) ? GRADE_SCALE_MIN : Math.round(clamped);
  let bandIndex = 0;
  for (const [index, band] of GRADE_BANDS.entries()) {
    if (shown >= band.min) {
      bandIndex = index;
    }
  }
  const band = GRADE_BANDS[bandIndex];
  const grade = band?.grade ?? 'F';
  const min = band?.min ?? GRADE_SCALE_MIN;
  const max = bandTop(bandIndex);
  return {
    grade,
    min,
    max,
    reason: `${String(shown)} is in the ${grade} band, ${String(min)} to ${String(max)}`,
  };
}

/**
 * The lowest value that earns `grade`, as a traced constant, for a trace that needs to cite a
 * band ("needs a B to headline").
 */
export function gradeFloorOf(grade: Grade): Traced<number> {
  const band = GRADE_BANDS.find((candidate) => candidate.grade === grade);
  return constantOf(`${grade} grade starts at`, band?.min ?? GRADE_SCALE_MIN, GRADE_BANDS_REASON);
}
