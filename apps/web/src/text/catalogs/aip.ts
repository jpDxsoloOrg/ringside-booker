import { registerTextCatalog } from '../renderTemplatedText';
import type { TextCatalog, TextParams } from '../renderTemplatedText';

/**
 * The rival desk's sentences (docs/design/rival-desk.md#needs and #roster-review): the weekly
 * roster review's summary and every roster need. The engine's `needSummaryText` and
 * `rosterReviewSummaryText` say the same words for the Why? panel; keep the two in step.
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

export const AIP_TEXT_CATALOG: TextCatalog = {
  'aip.decision.roster-review': rosterReview,
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
