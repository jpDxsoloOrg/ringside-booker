import { describe, expect, it } from 'vitest';
import { parseGameDate } from '@ringside/engine';
import type { AdvanceResult, GateHit } from '@ringside/engine';
import {
  describeAdvance,
  MAX_RESULTS_LINKS,
  moreResultsText,
  seeResultsText,
  stoppedForNews,
  stopReason,
} from './advanceSummaryText';

describe('the results links in the advance summary', () => {
  it('names the show to see', () => {
    expect(seeResultsText({ name: 'Altura Mainstage' })).toBe('See results: Altura Mainstage');
  });

  it('counts only the shows past the links', () => {
    expect(MAX_RESULTS_LINKS).toBe(3);
    expect(moreResultsText(0)).toBeNull();
    expect(moreResultsText(3)).toBeNull();
    expect(moreResultsText(4)).toBe('and 1 more');
    expect(moreResultsText(1_003)).toBe('and 1,000 more');
  });
});

describe('the reason a skip stopped', () => {
  const newsHit: GateHit = {
    gateId: 'news.alert',
    reason: 'News: Milestone – Calder Voss',
    subject: { kind: 'news', id: 'nws_0000000004' },
    actionHint: 'news',
  };
  const showHit: GateHit = {
    gateId: 'shows.tonight',
    reason: 'Tonight: Harbor Lights Showdown',
    actionHint: 'showNight',
  };

  function stoppedBy(hits: GateHit[]): AdvanceResult['stoppedBy'] {
    return { kind: 'gate', hits };
  }

  it("gives the news alert's reason when a news alert stopped it", () => {
    expect(stopReason(stoppedBy([newsHit]))).toBe('News: Milestone – Calder Voss');
    expect(stoppedForNews(stoppedBy([newsHit]))).toBe(true);
    const result: AdvanceResult = {
      startDate: parseGameDate('2031-01-01'),
      endDate: parseGameDate('2031-01-05'),
      daysAdvanced: 4,
      stoppedBy: stoppedBy([newsHit]),
      failures: [],
      eventsPublished: 0,
      timing: { ms: 0 },
    };
    expect(describeAdvance(result).announcement).toBe(
      'Advanced 4 days to Sunday, January 5, 2031. News: Milestone – Calder Voss.',
    );
  });

  it('gives the reason of the gate that decides the day button, not the first one listed', () => {
    expect(stopReason(stoppedBy([newsHit, showHit]))).toBe('Tonight: Harbor Lights Showdown');
    expect(stoppedForNews(stoppedBy([newsHit, showHit]))).toBe(false);
    expect(stoppedForNews({ kind: 'completed' })).toBe(false);
  });
});
