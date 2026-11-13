// The rival results' trace kinds (AIP5-01). Design: docs/design/rival-booking.md#winners
import { describe, expect, it } from 'vitest';
import type { SegmentId, TitleId } from '../../../../src/core/ids';
import { refKey, TRACE_REF_KIND_PATTERN } from '../../../../src/core/trace/store';
import {
  TITLE_TRACE_KIND,
  titleTraceRef,
  WINNER_TRACE_KIND,
  winnerTraceRef,
} from '../../../../src/systems/aip';
import { testId } from '../../../support/ids';

describe('the rival results trace kinds', () => {
  const segmentId: SegmentId = testId('segment');
  const titleId: TitleId = testId('title');

  it('are valid trace kinds of their own', () => {
    expect(TRACE_REF_KIND_PATTERN.test(WINNER_TRACE_KIND)).toBe(true);
    expect(TRACE_REF_KIND_PATTERN.test(TITLE_TRACE_KIND)).toBe(true);
    expect(WINNER_TRACE_KIND).not.toBe(TITLE_TRACE_KIND);
    expect(WINNER_TRACE_KIND).not.toBe('segment.rating');
  });

  it('round-trip through refKey', () => {
    const winner = winnerTraceRef(segmentId);
    expect(winner).toEqual({ kind: 'aip.winner', id: segmentId });
    expect(refKey(winner)).toBe(`aip.winner:${segmentId}`);

    const title = titleTraceRef(segmentId, titleId);
    expect(title).toEqual({ kind: 'aip.title', id: `${segmentId}|${titleId}` });
    const key = refKey(title);
    expect(key).toBe(`aip.title:${segmentId}|${titleId}`);
    const [kind, id] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
    expect({ kind, id }).toEqual(title);
    expect(id.split('|')).toEqual([segmentId, titleId]);
  });
});
