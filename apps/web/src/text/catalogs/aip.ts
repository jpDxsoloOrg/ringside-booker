import { registerTextCatalog } from '../renderTemplatedText';
import type { TextCatalog, TextParams } from '../renderTemplatedText';

/**
 * The rival desk's sentences (docs/design/rival-desk.md#needs and #roster-review, and
 * docs/design/rival-booking.md#show-day): the weekly roster review's summary, every roster need and
 * the card decisions. The engine's `needSummaryText`, `rosterReviewSummaryText`, `cardBookedText`
 * and `showCancelledText` say the same words for the Why? panel; keep them in step.
 * Importing this module registers it.
 */

function text(params: TextParams, name: string): string {
  const value = params[name];
  return value === undefined ? '' : String(value);
}

function rosterReview(params: TextParams): string {
  const count = Number(params['count'] ?? 0);
  const top = params['top'];
  if (!(count > 0) || top === undefined) return 'Weekly roster review: no pressing needs';
  return `Weekly roster review: ${String(count)} ${count === 1 ? 'need' : 'needs'}, most pressing: ${String(top)}`;
}

function plural(params: TextParams, name: string, one: string, many: string): string {
  const count = Number(params[name] ?? 0);
  return `${String(count)} ${count === 1 ? one : many}`;
}

function cardBooked(params: TextParams): string {
  return `Booked ${text(params, 'show')}: ${plural(params, 'matches', 'match', 'matches')}, ${plural(params, 'talking', 'talking segment', 'talking segments')}, ${plural(params, 'titles', 'title match', 'title matches')}`;
}

export const AIP_TEXT_CATALOG: TextCatalog = {
  'aip.decision.roster-review': rosterReview,
  'aip.decision.card-booked': cardBooked,
  'aip.decision.show-cancelled': 'Cancelled {show}: {reason}',
  'aip.need.depth': (params) =>
    `Thin at ${text(params, 'band').toLowerCase()}: ${text(params, 'have')} of ${text(params, 'target')}`,
  'aip.need.alignment.heels': 'Short on heels',
  'aip.need.alignment.faces': 'Short on faces',
  'aip.need.gender': '{division} thin: {have} of {target}',
  'aip.need.champion-gone': 'Champion has left: {title}',
  'aip.need.champion-unfit': 'Champion unfit: {names}, {reason}',
  'aip.need.champion-ending': "Champion's contract ends {date}",
  'aip.need.crew': 'Short of {role}: {have} of {target}',
};

registerTextCatalog('aip', AIP_TEXT_CATALOG);
