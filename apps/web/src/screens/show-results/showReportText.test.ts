import { describe, expect, it } from 'vitest';
import type { SegmentResultView } from '@ringside/engine';
import {
  drawResult,
  noContestResult,
  promoSegment,
  singlesWin,
  tripleThreatRetained,
} from '@/screens/dev-gallery/fixtures/segmentResults';
import {
  bestAndWorst,
  breakdownNote,
  expectationText,
  headlineText,
  pointsText,
  preShowFactorText,
  segmentHighlightText,
  starsText,
  verdictText,
} from './showReportText';

function rated(segment: SegmentResultView, stars: number, score: number): SegmentResultView {
  const rating = segment.rating;
  if (rating === null) throw new Error('Fixture has no rating');
  return { ...segment, rating: { ...rating, stars, score } };
}

describe('the headline', () => {
  it('words the verdict from the stars', () => {
    expect(verdictText(0)).toBe('A poor show');
    expect(verdictText(1.25)).toBe('A weak show');
    expect(verdictText(2.5)).toBe('A solid show');
    expect(verdictText(3.5)).toBe('A great show');
    expect(verdictText(4.5)).toBe('An outstanding show');
  });

  it('says the score and stars, and the expectation once EVT5 gives one', () => {
    expect(headlineText({ score: 64, stars: 2.5 }, null)).toBe('A solid show: 64, 2.5 stars');
    expect(headlineText({ score: 64, stars: 2.5 }, 61)).toBe(
      'A solid show: 64, 2.5 stars, 3 points above what fans expected',
    );
    expect(expectationText(50, 51.2)).toBe('1 point below what fans expected');
    expect(expectationText(50, 50.4)).toBe('just what fans expected');
  });

  it('counts stars in plain words', () => {
    expect(starsText(0)).toBe('No stars');
    expect(starsText(1)).toBe('1 star');
    expect(starsText(3.25)).toBe('3.25 stars');
  });
});

describe('bestAndWorst', () => {
  it('picks the highest and lowest stars, skipping unrated segments', () => {
    const segments = [
      rated(promoSegment(), 2, 60),
      rated(singlesWin(), 3, 70),
      { ...drawResult(), rating: null },
      rated(tripleThreatRetained(), 4.25, 84),
    ];
    const { best, worst } = bestAndWorst(segments);
    expect(best?.roleLabel).toBe('Main event');
    expect(worst?.roleLabel).toBe('Pre-show');
  });

  it('gives the tie for best to the later slot and never names one segment twice', () => {
    const tied = bestAndWorst([rated(singlesWin(), 3, 70), rated(tripleThreatRetained(), 3, 70)]);
    expect(tied.best?.roleLabel).toBe('Main event');
    expect(tied.worst?.roleLabel).toBe('Opener');
    expect(bestAndWorst([singlesWin()]).worst).toBeNull();
    expect(bestAndWorst([]).best).toBeNull();
  });

  it('names a segment by its role, who was in it and its stars', () => {
    expect(segmentHighlightText(rated(noContestResult(), 1, 41))).toMatch(
      /^Semi-main: .+ vs .+, 1 star$/,
    );
  });
});

describe('the score table words', () => {
  it('signs each share and explains the sum', () => {
    expect(pointsText(11.2)).toBe('+11.2');
    expect(pointsText(-5)).toBe('−5');
    expect(pointsText(0)).toBe('0');
    expect(breakdownNote(5)).toContain('the total weight (5)');
    expect(breakdownNote(0)).toBe('No slot counted toward the score.');
    expect(preShowFactorText(0)).toBe("Pre-show segments don't count toward the score.");
    expect(preShowFactorText(0.5)).toBe('Pre-show segments count at ×0.5 their slot weight.');
  });
});
