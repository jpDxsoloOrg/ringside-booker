// Grades. Design: docs/design/workers.md#grades
import { describe, expect, it } from 'vitest';
import {
  GRADE_BANDS,
  GRADE_BANDS_REASON,
  gradeFloorOf,
  gradeOf,
  GRADES,
} from '../../../src/systems/workers';
import { ALL_TUNABLES } from '../../../src/systems/tunables';
import { expectSerialisable, expectTraceContains } from '../../support/trace';

describe('GRADE_BANDS', () => {
  it('lists every grade once, lowest first, starting at 0', () => {
    expect(GRADE_BANDS.map((band) => band.grade)).toEqual([...GRADES]);
    expect(GRADE_BANDS.map((band) => band.min)).toEqual([
      0, 20, 30, 40, 47, 54, 60, 66, 72, 78, 84, 90, 96,
    ]);
  });

  it('is not controlled by any tunable', () => {
    expect(Object.keys(ALL_TUNABLES).filter((key) => key.toLowerCase().includes('grade'))).toEqual(
      [],
    );
  });
});

describe('gradeOf', () => {
  const edges: readonly (readonly [string, number, number])[] = [
    ['F', 0, 19],
    ['E', 20, 29],
    ['D', 30, 39],
    ['C-', 40, 46],
    ['C', 47, 53],
    ['C+', 54, 59],
    ['B-', 60, 65],
    ['B', 66, 71],
    ['B+', 72, 77],
    ['A-', 78, 83],
    ['A', 84, 89],
    ['A+', 90, 95],
    ['S', 96, 100],
  ];

  it.each(edges)('gives %s from %i to %i', (grade, min, max) => {
    expect(gradeOf(min)).toMatchObject({ grade, min, max });
    expect(gradeOf(max)).toMatchObject({ grade, min, max });
    if (min > 0) {
      expect(gradeOf(min - 1).grade).not.toBe(grade);
    }
    if (max < 100) {
      expect(gradeOf(max + 1).grade).not.toBe(grade);
    }
  });

  it('explains the band in player text', () => {
    expect(gradeOf(72)).toEqual({
      grade: 'B+',
      min: 72,
      max: 77,
      reason: '72 is in the B+ band, 72 to 77',
    });
    expect(gradeOf(0).reason).toBe('0 is in the F band, 0 to 19');
    expect(gradeOf(100).reason).toBe('100 is in the S band, 96 to 100');
  });

  it('keeps values inside 0 to 100', () => {
    expect(gradeOf(-5)).toEqual(gradeOf(0));
    expect(gradeOf(140)).toEqual(gradeOf(100));
    expect(gradeOf(Number.POSITIVE_INFINITY).grade).toBe('S');
    expect(gradeOf(Number.NEGATIVE_INFINITY).grade).toBe('F');
    expect(gradeOf(Number.NaN).grade).toBe('F');
  });

  it('grades the whole number the screen shows', () => {
    expect(gradeOf(77.4)).toMatchObject({ grade: 'B+', reason: '77 is in the B+ band, 72 to 77' });
    expect(gradeOf(77.5)).toMatchObject({ grade: 'A-', reason: '78 is in the A- band, 78 to 83' });
    expect(gradeOf(19.49).grade).toBe('F');
    expect(gradeOf(95.5).grade).toBe('S');
  });
});

describe('gradeFloorOf', () => {
  it('is a traced constant with the reason the bands are fixed', () => {
    const floor = gradeFloorOf('B+');
    expect(floor.value).toBe(72);
    const node = expectTraceContains(floor, { kind: 'constant', label: 'B+ grade starts at' });
    expect(node.reason).toBe(GRADE_BANDS_REASON);
    expect(GRADE_BANDS_REASON).toBe('Display bands for grades');
    expectSerialisable(floor);
  });
});
