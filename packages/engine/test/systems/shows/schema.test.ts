// The show results schema of EVT3-01. Design: docs/design/show-night.md, docs/design/data-model.md
import { describe, expect, it } from 'vitest';
import { cents } from '../../../src/core/money';
import { EventInstanceSchema } from '../../../src/model/entities/event-instance';
import { SegmentRatingSchema, SegmentSchema } from '../../../src/model/entities/segment';
import { makeAngle, makeInstance, makeMatch } from '../../support/show-world';

const FULL_RATING = {
  score: 71,
  stars: 3.5,
  workRate: 70,
  crowd: 74,
  expectation: 68,
  traceId: 'shows.segmentScore:seg_0000000001',
};

/** A copy of `value` without `key`, to check a required field. */
function without(value: Readonly<Record<string, unknown>>, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));
}

const SHOW_RESULT = {
  score: 62,
  rawScore: 66,
  traceId: 'shows.showScore:evi_0000000001',
  attendance: null,
  gate: null,
  viewers: null,
};

describe('segment rating', () => {
  it('parses a rating with every component', () => {
    expect(SegmentRatingSchema.safeParse(FULL_RATING).success).toBe(true);
    expect(SegmentSchema.safeParse({ ...makeMatch(1), rating: FULL_RATING }).success).toBe(true);
  });

  it('accepts a talking segment with no work rate', () => {
    const rating = { ...FULL_RATING, workRate: null };
    expect(SegmentSchema.safeParse({ ...makeAngle(1), rating }).success).toBe(true);
  });

  it('rejects a rating missing workRate, so older saves no longer load', () => {
    expect(SegmentRatingSchema.safeParse(without(FULL_RATING, 'workRate')).success).toBe(false);
  });

  it('rejects a component outside 0-100', () => {
    expect(SegmentRatingSchema.safeParse({ ...FULL_RATING, crowd: 101 }).success).toBe(false);
    expect(SegmentRatingSchema.safeParse({ ...FULL_RATING, expectation: -1 }).success).toBe(false);
  });
});

describe('show result', () => {
  it('requires a result on a completed show and accepts null attendance, gate and viewers', () => {
    const completed = makeInstance(1, { status: 'completed' });
    expect(EventInstanceSchema.safeParse({ ...completed, result: null }).success).toBe(false);
    expect(EventInstanceSchema.safeParse({ ...completed, result: SHOW_RESULT }).success).toBe(true);
  });

  it('accepts filled-in attendance, gate and viewers', () => {
    const result = { ...SHOW_RESULT, attendance: 2800, gate: cents(8_400_000), viewers: 150_000 };
    const completed = makeInstance(1, { status: 'completed', result });
    expect(EventInstanceSchema.safeParse(completed).success).toBe(true);
  });

  it('requires rawScore', () => {
    const withoutRawScore = without(SHOW_RESULT, 'rawScore');
    const completed = makeInstance(1, { status: 'completed' });
    expect(EventInstanceSchema.safeParse({ ...completed, result: withoutRawScore }).success).toBe(
      false,
    );
  });

  it('still rejects a result on a show that is not completed', () => {
    const scheduled = makeInstance(1, { status: 'scheduled' });
    expect(EventInstanceSchema.safeParse({ ...scheduled, result: SHOW_RESULT }).success).toBe(
      false,
    );
  });
});
