// The shows system's trace kinds and refs (EVT3-01). Design: docs/design/show-night.md#events
import { describe, expect, it } from 'vitest';
import { refKey, TRACE_REF_KIND_PATTERN } from '../../../src/core/trace/store';
import {
  RIVAL_SEGMENT_SCORE_TRACE_KIND,
  SEGMENT_SCORE_TRACE_KIND,
  SHOWS_TRACE_KINDS,
  segmentScoreTraceRef,
  showScoreTraceRef,
  titleOutcomeTraceRef,
  traceRefFromKey,
} from '../../../src/systems/shows';
import { instanceId, segmentId, titleId } from '../../support/show-world';

const SEGMENT = segmentId(4);
const SHOW = instanceId(1);
const TITLE = titleId(2);

describe('shows trace refs', () => {
  it('uses kinds that match the trace kind pattern', () => {
    expect(SHOWS_TRACE_KINDS).toHaveLength(4);
    for (const kind of SHOWS_TRACE_KINDS) {
      expect(kind).toMatch(TRACE_REF_KIND_PATTERN);
    }
  });

  it('keeps human and computer-controlled segment scores under separate kinds', () => {
    expect(segmentScoreTraceRef(SEGMENT, true)).toEqual({
      kind: SEGMENT_SCORE_TRACE_KIND,
      id: SEGMENT,
    });
    expect(segmentScoreTraceRef(SEGMENT, false)).toEqual({
      kind: RIVAL_SEGMENT_SCORE_TRACE_KIND,
      id: SEGMENT,
    });
  });

  it('round-trips every ref through its key', () => {
    const refs = [
      segmentScoreTraceRef(SEGMENT, true),
      segmentScoreTraceRef(SEGMENT, false),
      showScoreTraceRef(SHOW),
      titleOutcomeTraceRef(SEGMENT, TITLE),
    ];
    for (const ref of refs) {
      expect(traceRefFromKey(refKey(ref))).toEqual(ref);
    }
    expect(titleOutcomeTraceRef(SEGMENT, TITLE).id).toBe(`${SEGMENT}|${TITLE}`);
  });

  it('splits on the first colon, so an id may contain one', () => {
    expect(traceRefFromKey('shows.showScore:a:b')).toEqual({ kind: 'shows.showScore', id: 'a:b' });
  });

  it('returns null for a key that names no ref', () => {
    expect(traceRefFromKey('')).toBeNull();
    expect(traceRefFromKey('shows.showScore')).toBeNull();
    expect(traceRefFromKey(':evi_0000000001')).toBeNull();
    expect(traceRefFromKey('shows.showScore:')).toBeNull();
  });
});
