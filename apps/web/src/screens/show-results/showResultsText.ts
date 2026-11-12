/**
 * The words of the results page, kept apart from the components so they can be tested on their
 * own. Nothing here is a time: a card has slots, never minutes (D-10).
 */
import type { EventImportance, SegmentResultView, ShowResultView } from '@ringside/engine';
import type { LowerThirdAccent } from '@/components/LowerThird';
import { formatNumber } from '@/components/format';
import { starRatingLabel } from '@/components/StarRating';

/** Gold for the shows that matter most, cyan for the rest. */
export function headerAccent(importance: EventImportance): LowerThirdAccent {
  return importance === 'major' || importance === 'flagship' ? 'prestige' : 'data';
}

/** "Test Promotion B's card for this show wasn't booked in detail." */
export function offscreenNote(promotionName: string): string {
  return `${promotionName}'s card for this show wasn't booked in detail.`;
}

/** True when a side has more than one competitor, so its verb is plural ("win", not "wins"). */
function isPluralSide(segment: SegmentResultView, side: number): boolean {
  const members = segment.sides.find((entry) => entry.side === side)?.members ?? [];
  return members.filter((member) => member.role === 'competitor').length > 1;
}

/**
 * What the live region says as a card is revealed: "Main event: Kai Moreno wins by Pinfall",
 * "Opener: Draw", "Midcard: Promo". Just the role when there is no result.
 */
export function revealAnnouncement(segment: SegmentResultView): string {
  const role = segment.roleLabel;
  if (segment.kind === 'angle') return `${role}: ${segment.typeName}`;
  const { outcome } = segment;
  if (outcome === null) return role;
  if (outcome.kind === 'draw') return `${role}: Draw`;
  if (outcome.kind === 'noContest') return `${role}: No contest`;
  const side = outcome.winningSide ?? 0;
  const winners = segment.sides.find((entry) => entry.side === side)?.label ?? 'The winners';
  const verb = isPluralSide(segment, side) ? 'win' : 'wins';
  const method = outcome.methodName === undefined ? '' : ` by ${outcome.methodName}`;
  return `${role}: ${winners} ${verb}${method}`;
}

/** "Final score 62, 2.25 stars out of 5": what the live region says when the score comes in. */
export function scoreAnnouncement(result: Pick<ShowResultView, 'score' | 'stars'>): string {
  return `Final score ${formatNumber(result.score)}, ${starRatingLabel(result.stars)}`;
}
