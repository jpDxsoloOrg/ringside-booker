import { describe, expect, it } from 'vitest';
import type { SegmentResultView } from '@ringside/engine';
import {
  drawResult,
  noContestResult,
  promoSegment,
  singlesWin,
  tagNewChampions,
} from '@/screens/dev-gallery/fixtures/segmentResults';
import { RUNNING_TIME_WORDS } from '@/test/runningTimeWords';
import {
  headerAccent,
  offscreenNote,
  revealAnnouncement,
  scoreAnnouncement,
} from './showResultsText';

describe('headerAccent', () => {
  it('is gold for major and flagship shows and cyan for the rest', () => {
    expect(headerAccent('flagship')).toBe('prestige');
    expect(headerAccent('major')).toBe('prestige');
    expect(headerAccent('regular')).toBe('data');
    expect(headerAccent('house')).toBe('data');
  });
});

describe('revealAnnouncement', () => {
  it('names the role, the winners and the method, singular or plural', () => {
    const singles = singlesWin();
    expect(revealAnnouncement(singles)).toMatch(new RegExp(`^${singles.roleLabel}: .+ wins by `));
    const tag = tagNewChampions();
    expect(revealAnnouncement(tag)).toMatch(new RegExp(`^${tag.roleLabel}: .+ win by `));
  });

  it('says draw, no contest, a talking segment type, or just the role', () => {
    expect(revealAnnouncement(drawResult())).toMatch(/: Draw$/);
    expect(revealAnnouncement(noContestResult())).toMatch(/: No contest$/);
    const promo = promoSegment();
    expect(revealAnnouncement(promo)).toBe(`${promo.roleLabel}: ${promo.typeName}`);
    const unrun: SegmentResultView = { ...singlesWin(), outcome: null };
    expect(revealAnnouncement(unrun)).toBe(unrun.roleLabel);
  });

  it('never mentions a running time', () => {
    for (const segment of [singlesWin(), tagNewChampions(), promoSegment()]) {
      expect(revealAnnouncement(segment)).not.toMatch(RUNNING_TIME_WORDS);
    }
  });
});

describe('the results notes', () => {
  it('reads the score and stars in words', () => {
    expect(scoreAnnouncement({ score: 62, stars: 2.25 })).toBe(
      'Final score 62, 2.25 stars out of 5',
    );
  });

  it('says a rival card was not booked in detail', () => {
    expect(offscreenNote('Test Promotion B')).toBe(
      "Test Promotion B's card for this show wasn't booked in detail.",
    );
  });
});
