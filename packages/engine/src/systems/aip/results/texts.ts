/**
 * The rival results' words (AIP5-04): the decision log summaries of a show's winners and of each
 * title kept or moved, and the trace notes for title matches without a champion in them. The web
 * catalog (`apps/web/src/text/catalogs/aip.ts`) says the same sentences; keep them in step.
 * See docs/design/rival-booking.md#how-a-rival-shows-results-are-decided.
 */

import type { TemplatedText } from '../../../model/primitives';

/** Params `show`, `matches`. */
export const WINNERS_BOOKED_SUMMARY_KEY = 'aip.decision.winners-booked';
/** Params `champion`, `title`, `reason` (+ the view's `segment`, `plan`, `chance`, `reignDays`). */
export const TITLE_RETAIN_SUMMARY_KEY = 'aip.decision.title-retain';
/** Params `challenger`, `title`, `champion`, `reason` (+ the view's params). */
export const TITLE_CHANGE_SUMMARY_KEY = 'aip.decision.title-change';
/** Params `challenger`, `title`, `reason` (+ the view's params): a vacant title filled. */
export const TITLE_CROWN_SUMMARY_KEY = 'aip.decision.title-crown';
/** Params `title`, `reason` (+ the view's params): a vacant title nobody here can win. */
export const TITLE_VACANT_SUMMARY_KEY = 'aip.decision.title-vacant';

export const VACANT_TITLE_NOTE = 'Vacant title: the booker crowns the best fit';
export const CHAMPION_ABSENT_NOTE = "The champion isn't in this match";
export const NOBODY_CAN_HOLD_NOTE = "Nobody here can hold the title, so it can't change hands";
export const ONLY_ONE_FIT_NOTE = 'Only one side here can hold the title';
export const NO_DRAWS_ON_TITLES_NOTE = 'Title matches are never booked as draws';
export const NO_METHOD_NOTE = 'No way of winning fits this match, so it is booked as a no contest';
export const BEST_VALUE_REASON = 'Highest value on the night';
export const NO_CONTEST_REASON = 'No contest';

/** "Follows the World Title decision": a second title on the same match. */
export function followsText(leadTitle: string): string {
  return `Follows the ${leadTitle} decision`;
}

function param(summary: TemplatedText, name: string): string {
  const value = summary.params[name];
  return value === undefined ? '' : String(value);
}

/** "Monday Night Brawl: winners booked for 5 matches". */
export function winnersBookedText(summary: TemplatedText): string {
  const count = Number(summary.params['matches'] ?? 0);
  return `${param(summary, 'show')}: winners booked for ${String(count)} ${count === 1 ? 'match' : 'matches'}`;
}

/** "Kai Moreno to retain the World Title (Champion retains)". */
export function titleRetainText(summary: TemplatedText): string {
  return `${param(summary, 'champion')} to retain the ${param(summary, 'title')} (${param(summary, 'reason')})`;
}

/** "Vance Troy to win the World Title from Kai Moreno (Contract ending)". */
export function titleChangeText(summary: TemplatedText): string {
  return `${param(summary, 'challenger')} to win the ${param(summary, 'title')} from ${param(summary, 'champion')} (${param(summary, 'reason')})`;
}

/** "Vance Troy to win the vacant World Title (Vacant title: the booker crowns the best fit)". */
export function titleCrownText(summary: TemplatedText): string {
  return `${param(summary, 'challenger')} to win the vacant ${param(summary, 'title')} (${param(summary, 'reason')})`;
}

/** "The World Title stays vacant (Nobody here can hold ...)". */
export function titleVacantText(summary: TemplatedText): string {
  return `The ${param(summary, 'title')} stays vacant (${param(summary, 'reason')})`;
}

/** The sentence of one of AIP5's summaries, or null for any other key. */
export function resultsSummaryText(summary: TemplatedText): string | null {
  switch (summary.key) {
    case WINNERS_BOOKED_SUMMARY_KEY:
      return winnersBookedText(summary);
    case TITLE_RETAIN_SUMMARY_KEY:
      return titleRetainText(summary);
    case TITLE_CHANGE_SUMMARY_KEY:
      return titleChangeText(summary);
    case TITLE_CROWN_SUMMARY_KEY:
      return titleCrownText(summary);
    case TITLE_VACANT_SUMMARY_KEY:
      return titleVacantText(summary);
    default:
      return null;
  }
}
