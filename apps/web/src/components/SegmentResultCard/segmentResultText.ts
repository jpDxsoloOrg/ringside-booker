/**
 * The words of a `SegmentResultCard`, kept apart from the component so they can be tested on their
 * own. Nothing here is a time: a segment has a duration class word, never minutes (D-10).
 */
import type { SegmentResultView, SegmentTitleView } from '@ringside/engine';

/** The colour bar down the card's edge, the same three as `CardSlot`'s. */
export type SegmentResultAccent = 'action' | 'prestige' | 'data';

/** Red-orange for the main event, gold for a title match, cyan for the rest. */
export function segmentResultAccent(
  segment: Pick<SegmentResultView, 'roleKey' | 'titles'>,
): SegmentResultAccent {
  if (segment.roleKey === 'mainEvent') return 'action';
  return segment.titles.length > 0 ? 'prestige' : 'data';
}

/** "Slot 3: Midcard": the heading as a screen reader says it. */
export function slotHeadingLabel(segment: Pick<SegmentResultView, 'slotNumber' | 'roleLabel'>) {
  return `Slot ${String(segment.slotNumber)}: ${segment.roleLabel}`;
}

/** "A", "A and B", "A, B and C". */
export function listText(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1) ?? ''}`;
}

/**
 * The result in one line: "Kai Moreno def. Vance Troy · Pinfall", "Draw", "No contest", or a
 * talking segment's type ("Promo"). Null for a match with no result yet.
 */
export function resultLine(
  segment: Pick<SegmentResultView, 'kind' | 'typeName' | 'outcome' | 'sides'>,
): string | null {
  if (segment.kind === 'angle') return segment.typeName;
  const { outcome } = segment;
  if (outcome === null) return null;
  if (outcome.kind === 'draw') return 'Draw';
  if (outcome.kind === 'noContest') return 'No contest';
  const winners = segment.sides.find((side) => side.side === outcome.winningSide);
  const losers = segment.sides.filter((side) => side.side !== outcome.winningSide);
  const line = `${winners?.label ?? 'Winners'} def. ${listText(losers.map((side) => side.label))}`;
  return outcome.methodName === undefined ? line : `${line} · ${outcome.methodName}`;
}

/**
 * What the result's Why? button explains: the method and the finish ("Pinfall · Clean"), else the
 * kind of result ("Draw", "No contest").
 */
export function resultWhyValue(
  outcome: Pick<NonNullable<SegmentResultView['outcome']>, 'kind' | 'methodName' | 'finishName'>,
): string {
  const parts = [outcome.methodName, outcome.finishName].filter(
    (part): part is string => part !== undefined,
  );
  if (parts.length > 0) return parts.join(' · ');
  if (outcome.kind === 'draw') return 'Draw';
  if (outcome.kind === 'noContest') return 'No contest';
  return 'Win';
}

/** The side that won, or null for a draw, a no contest, a talking segment or no result. */
export function winningSideOf(segment: Pick<SegmentResultView, 'outcome'>): number | null {
  return segment.outcome?.kind === 'win' ? (segment.outcome.winningSide ?? null) : null;
}

/** The banner of a title on the line, or null when it has none (no contest, not run yet). */
export interface TitleBannerText {
  readonly tone: 'prestige' | 'neutral';
  /** "NEW CHAMPION: Kai Moreno", "Retained", "Still vacant". */
  readonly headline: string;
  /** The outcome as the Why? button says it: "Why is the Coastal Crown outcome retained?". */
  readonly whyValue: string;
}

export function titleBannerText(
  title: Pick<SegmentTitleView, 'outcome' | 'newHolderNames'>,
  winnerLabel: string | null,
): TitleBannerText | null {
  switch (title.outcome) {
    case 'newChampion': {
      const names =
        title.newHolderNames.length > 0 ? title.newHolderNames.join(' & ') : (winnerLabel ?? '');
      return {
        tone: 'prestige',
        headline: names === '' ? 'NEW CHAMPION' : `NEW CHAMPION: ${names}`,
        whyValue: 'new champion',
      };
    }
    case 'retained':
      return { tone: 'neutral', headline: 'Retained', whyValue: 'retained' };
    case 'stillVacant':
      return { tone: 'neutral', headline: 'Still vacant', whyValue: 'still vacant' };
    case 'none':
      return null;
  }
}

/** "Coming up: Main event": the placeholder before the card is revealed. */
export function comingUpText(segment: Pick<SegmentResultView, 'roleLabel'>): string {
  return `Coming up: ${segment.roleLabel}`;
}
