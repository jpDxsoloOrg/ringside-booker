/**
 * The words of the show report at the top of a results page (EVT3-09), kept apart from the
 * components so they can be tested on their own. Every number comes from `shows.results`; nothing
 * here works a score out again.
 */
import type {
  SegmentResultView,
  ShowResultView,
  ShowResultsView,
  ShowScoreRowView,
} from '@ringside/engine';
import { formatNumber, formatSigned } from '@/components/format';
import { listText } from '@/components/SegmentResultCard/segmentResultText';

/** The verdict in words, from the stars: highest threshold first. */
const VERDICTS: readonly { readonly minStars: number; readonly words: string }[] = [
  { minStars: 4.25, words: 'An outstanding show' },
  { minStars: 3.25, words: 'A great show' },
  { minStars: 2.25, words: 'A solid show' },
  { minStars: 1.25, words: 'A weak show' },
  { minStars: 0, words: 'A poor show' },
];

/** "A solid show", from the show's stars. */
export function verdictText(stars: number): string {
  return VERDICTS.find((verdict) => stars >= verdict.minStars)?.words ?? 'A poor show';
}

/** "2.5 stars", "1 star", "No stars". */
export function starsText(stars: number): string {
  if (stars === 0) return 'No stars';
  const shown = formatNumber(stars, { maximumFractionDigits: 2 });
  return `${shown} ${stars === 1 ? 'star' : 'stars'}`;
}

/** "3 points above what fans expected", "just what fans expected", "1 point below …". */
export function expectationText(score: number, expectation: number): string {
  const gap = Math.round(score - expectation);
  if (gap === 0) return 'just what fans expected';
  const points = `${formatNumber(Math.abs(gap))} ${Math.abs(gap) === 1 ? 'point' : 'points'}`;
  return `${points} ${gap > 0 ? 'above' : 'below'} what fans expected`;
}

/**
 * The headline in one line: "A solid show: 64, 2.5 stars, 3 points above what fans expected".
 * Without an expectation (the show region's, from EVT5) it stops after the stars.
 */
export function headlineText(
  result: Pick<ShowResultView, 'score' | 'stars'>,
  expectation: number | null,
): string {
  const base = `${verdictText(result.stars)}: ${formatNumber(result.score)}, ${starsText(result.stars)}`;
  return expectation === null ? base : `${base}, ${expectationText(result.score, expectation)}`;
}

/** Who was in a segment, in a few words: "Kai Moreno vs Vance Troy", "Promo: Rex Vale". */
export function segmentShortName(segment: Pick<SegmentResultView, 'kind' | 'sides' | 'typeName'>) {
  const sides = segment.sides.map((side) => side.label).filter((label) => label !== '');
  if (segment.kind === 'angle') {
    return sides.length === 0 ? segment.typeName : `${segment.typeName}: ${listText(sides)}`;
  }
  return sides.length === 0 ? segment.typeName : sides.join(' vs ');
}

export interface BestAndWorst {
  readonly best: SegmentResultView | null;
  /** Null when fewer than two segments were rated, so one segment is never both. */
  readonly worst: SegmentResultView | null;
}

/** Higher stars first, then the higher score, then the later slot (the main event wins ties). */
function compareSegments(left: SegmentResultView, right: SegmentResultView): number {
  const leftRating = left.rating;
  const rightRating = right.rating;
  if (leftRating === null || rightRating === null) return 0;
  return rightRating.stars - leftRating.stars || rightRating.score - leftRating.score;
}

/** The best and worst rated segments of the card. */
export function bestAndWorst(segments: readonly SegmentResultView[]): BestAndWorst {
  // Reversed first, so a tie goes to the later slot for best and the earlier one for worst.
  const rated = segments.filter((segment) => segment.rating !== null);
  const ordered = [...rated].reverse().sort(compareSegments);
  const best = ordered[0] ?? null;
  const worst = rated.length < 2 ? null : (ordered.at(-1) ?? null);
  return { best, worst: worst === best ? null : worst };
}

/** "Main event: Kai Moreno vs Vance Troy, 3.5 stars". */
export function segmentHighlightText(segment: SegmentResultView): string {
  const stars = segment.rating === null ? '' : `, ${starsText(segment.rating.stars)}`;
  return `${segment.roleLabel}: ${segmentShortName(segment)}${stars}`;
}

/** A share of the show score in points: "+11.2", "−5", "0". Two decimals at most. */
export function pointsText(points: number): string {
  return formatSigned(points, { maximumFractionDigits: 2 });
}

/** A weight: "×1.75". */
export function weightText(weight: number): string {
  return `×${formatNumber(weight, { maximumFractionDigits: 2 })}`;
}

/** What a row of the "How it was scored" table is called. */
export function rowLabel(row: ShowScoreRowView, segment: SegmentResultView | undefined): string {
  if (row.kind !== 'segment') return row.label;
  return segment === undefined ? row.label : `${row.label}: ${segmentShortName(segment)}`;
}

/** "Each segment counts by its weight: score × weight ÷ the total weight (5)." */
export function breakdownNote(totalWeight: number): string {
  if (totalWeight === 0) return 'No slot counted toward the score.';
  return `Each segment's share is its score × its weight ÷ the total weight (${formatNumber(totalWeight, { maximumFractionDigits: 2 })}). The shares add up to the show score.`;
}

/** "The pre-show counts at ×0 of its weight", for the pre-show factor's own row. */
export function preShowFactorText(factor: number): string {
  if (factor === 0) return "Pre-show segments don't count toward the score.";
  return `Pre-show segments count at ${weightText(factor)} their slot weight.`;
}

/** Whether the report has anything to say: a completed show of the viewer's or anyone's. */
export function hasReport(view: Pick<ShowResultsView, 'offscreen' | 'segments'>): boolean {
  return !view.offscreen && view.segments.length > 0;
}
