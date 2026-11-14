// The storyline page's timeline rows from the page's own heat steps (CRTV4-06): a counted linked
// segment reads "heat before → after" even before `storylines.timeline` answers.
import { describe, expect, it } from 'vitest';
import { parseId } from '@ringside/engine';
import type { StorylineTimelineEntry, TraceRef } from '@ringside/engine';
import { heatTimelineEntries } from './HeatTimeline';

const STEP_REF: TraceRef = { kind: 'storylines.heatStep', id: 'test-step' };

function entry(fields: Partial<StorylineTimelineEntry>): StorylineTimelineEntry {
  return {
    segmentId: parseId('segment', 'seg_0000000901'),
    eventInstanceId: parseId('eventInstance', 'evi_0000000901'),
    eventName: 'Test Show',
    date: '2026-01-05',
    slot: 1,
    preShow: false,
    kind: 'match',
    label: 'Test A vs Test B',
    stars: 3,
    ratingTraceId: null,
    isFinale: false,
    heatBefore: null,
    heatAfter: null,
    heatTraceRef: null,
    ...fields,
  };
}

describe('heatTimelineEntries', () => {
  it('reads a counted step from the storyline page while the timeline query has no rows', () => {
    const rows = heatTimelineEntries(
      { timeline: [entry({ heatBefore: 42, heatAfter: 51, heatTraceRef: STEP_REF })] },
      [],
      '2026-01-06',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      state: 'counted',
      heat: { before: 42, after: 51, traceRef: STEP_REF },
    });
  });

  it('keeps a run segment without a step as not counted, and a future one as booked', () => {
    const rows = heatTimelineEntries(
      {
        timeline: [
          entry({}),
          entry({
            segmentId: parseId('segment', 'seg_0000000902'),
            eventInstanceId: parseId('eventInstance', 'evi_0000000902'),
            date: '2026-01-12',
            stars: null,
          }),
        ],
      },
      [],
      '2026-01-06',
    );
    expect(rows.map((row) => [row.state, row.heat])).toEqual([
      ['booked', null],
      ['notCounted', null],
    ]);
  });
});
