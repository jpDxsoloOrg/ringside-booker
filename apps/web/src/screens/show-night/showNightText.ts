import type { LiveShowStage, SegmentResultView } from '@ringside/engine';
import { slotHeadingLabel } from '@/components/SegmentResultCard/segmentResultText';
import { starRatingLabel } from '@/components/StarRating';
import { formatNumber } from '@/components/format';
import { revealAnnouncement } from '@/screens/show-results/showResultsText';

/** The controls' words, shared with tests and the e2e helpers. */
export const SHOW_NIGHT_LABELS = {
  runNext: 'Run next segment',
  simRest: 'Sim the rest of the show',
  leave: 'Leave and finish later',
  results: 'See the results',
  fixCard: 'Fix the card',
  bookCard: 'Book the card',
  finish: 'Finish the show',
} as const;

/** Where one segment stands on the night. */
export type SegmentProgress = 'done' | 'next' | 'toCome';

/** What the running order says beside each segment. */
export const PROGRESS_LABELS: Readonly<Record<SegmentProgress, string>> = {
  done: 'Done',
  next: 'Up next',
  toCome: 'Still to come',
};

/** "Slot 2: Midcard"; a pre-show segment's role already reads "Pre-show". */
export function segmentTitle(segment: Pick<SegmentResultView, 'slotNumber' | 'roleLabel'>): string {
  return slotHeadingLabel(segment);
}

/** "Singles: Rook Adler vs Vale Mercer", or the talking segment's type and who is in it. */
export function segmentLine(
  segment: Pick<SegmentResultView, 'typeName' | 'sides' | 'label'>,
): string {
  const people = segment.sides.map((side) => side.label).filter((label) => label !== '');
  const who = people.join(' vs ');
  return who === '' ? segment.typeName : `${segment.typeName}: ${who}`;
}

/** "3 of 7 segments run". */
export function progressText(run: number, total: number): string {
  return `${String(run)} of ${String(total)} ${total === 1 ? 'segment' : 'segments'} run`;
}

/** "4 segments still to run", "1 segment still to run". */
export function segmentsLeftText(left: number): string {
  return `${String(left)} ${left === 1 ? 'segment' : 'segments'} still to run`;
}

/** The kicker over the show's name. */
export const STAGE_KICKERS: Readonly<Record<LiveShowStage, string>> = {
  notStarted: 'Tonight',
  live: 'Live',
  finished: "Show's over",
};

/**
 * What the live region reads once a segment has run: its result, then its stars and score. A
 * segment that could not be rated reads only its result.
 */
export function segmentAnnouncement(segment: SegmentResultView): string {
  const result = revealAnnouncement(segment);
  const { rating } = segment;
  if (rating === null) return result;
  return `${result}. ${starRatingLabel(rating.stars)}, score ${formatNumber(rating.score)}`;
}

/** What the live region reads when the show ends: "Show's over. Final score 64, 3 out of 5 stars". */
export function finalAnnouncement(score: number, stars: number): string {
  return `Show's over. Final score ${formatNumber(score)}, ${starRatingLabel(stars)}`;
}
