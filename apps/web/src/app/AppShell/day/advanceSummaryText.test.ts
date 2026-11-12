import { describe, expect, it } from 'vitest';
import { MAX_RESULTS_LINKS, moreResultsText, seeResultsText } from './advanceSummaryText';

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
