import { registerTextCatalog } from '../catalog';
import type { TextCatalog, TextParams } from '../catalog';

/**
 * The news wire's words (docs/design/news.md#content-keys): a headline and a body for every news
 * topic the engine registers. Stories store only the topic's keys and params; these lines are
 * written at display time by `renderTemplatedText`, so names come from the query's `names` and a
 * later language pack needs no save change.
 *
 * Plain broadcast English about our own fictional world: no real names, and never a match length
 * or a number of minutes (D-10). `news.en.test.ts` checks every registered topic has both lines
 * and uses only its declared params. Importing this module registers it.
 */

/** How many people a comma-joined id param names. */
function countOf(params: TextParams, name: string): number {
  const value = params[name];
  return typeof value === 'string' ? value.split(',').filter((part) => part !== '').length : 1;
}

/** "reaches" for one holder, "reach" for a team. */
function verb(params: TextParams, name: string, one: string, many: string): string {
  return countOf(params, name) > 1 ? many : one;
}

/** True when the param is there and, for an id list, names somebody. */
function has(params: TextParams, name: string): boolean {
  const value = params[name];
  return typeof value === 'string' ? value !== '' : value !== undefined;
}

/** "{years:count} year" or "{years:count} years". */
function yearsText(params: TextParams): string {
  return Number(params['years']) === 1 ? '{years:count} year' : '{years:count} years';
}

/** How long a reign has run: in years for an anniversary, in days for a day mark. */
function reignLength(params: TextParams): string {
  return params['years'] !== undefined ? yearsText(params) : '{days:count} days';
}

export const NEWS_TEXT_CATALOG: TextCatalog = {
  'news.season-start.headline': 'Season {seasonNumber} has begun',
  'news.season-start.body':
    'Season {seasonNumber} is under way in {worldName}. It opened on {startDate:date} and runs until {endDate:date}.',

  'news.reign-milestone.headline': (params) =>
    `{holderIds} ${verb(params, 'holderIds', 'reaches', 'reach')} ${reignLength(params)} holding the {titleId}`,
  'news.reign-milestone.body': (params) =>
    `As of {onDate:date}, {holderIds} ${verb(params, 'holderIds', 'has', 'have')} held the {titleId} for ${reignLength(params)}. The longer a reign lasts, the more the belt means to whoever finally takes it.`,

  'news.reign-record.headline': (params) =>
    `{holderIds} now ${verb(params, 'holderIds', 'holds', 'hold')} the longest {titleId} reign ever`,
  'news.reign-record.body':
    'On {onDate:date}, {holderIds} passed {days:count} days with the {titleId}, going beyond the reign of {previousHolderIds} to set a new record for the title.',

  'news.career-anniversary.headline': (params) =>
    `{personId} marks ${yearsText(params)} in the ring`,
  'news.career-anniversary.body': (params) =>
    `{personId} reached ${yearsText(params)} as a professional on {onDate:date}. Few careers in the business last that long.`,

  'news.promotion-anniversary.headline': '{promotionId} turns {years:count}',
  'news.promotion-anniversary.body': (params) =>
    `{promotionId} celebrated ${yearsText(params)} in business on {onDate:date}, still running shows and still looking for its next big star.`,

  // Show night (EVT3, wired by DAY1-06).
  'news.show-result.headline': '{eventInstanceId} scores {score:count} out of 100',
  'news.show-result.body': (params) =>
    has(params, 'mainEventIds')
      ? '{promotionId} ran {eventInstanceId}, headlined by {mainEventIds}. The show scored {score:count} out of 100.'
      : '{promotionId} ran {eventInstanceId}. The show scored {score:count} out of 100.',

  'news.title-change.headline': (params) =>
    has(params, 'previousHolderIds')
      ? `{newHolderIds} ${verb(params, 'newHolderIds', 'wins', 'win')} the {titleId}`
      : `{newHolderIds} ${verb(params, 'newHolderIds', 'is', 'are')} crowned {titleId} champion`,
  'news.title-change.body': (params) =>
    has(params, 'previousHolderIds')
      ? `{newHolderIds} took the {titleId} from {previousHolderIds} at {eventInstanceId}. A new reign begins.`
      : `{newHolderIds} won the vacant {titleId} at {eventInstanceId} and ${verb(params, 'newHolderIds', 'becomes', 'become')} the new champion.`,

  // The calendar (EVT1, wired by DAY1-06).
  'news.show-cancelled.headline': '{promotionId} calls off {eventInstanceId}',
  'news.show-cancelled.body':
    '{promotionId} will not run {eventInstanceId} after all. Fans holding tickets will have to wait for the next big show.',

  // Contracts (ECO4, wired by DAY1-06). Who and where only: never wages or severance.
  'news.signing.headline': '{promotionId} signs {personId}',
  'news.signing.body':
    '{personId} is now under contract with {promotionId}. Expect to see them on its shows soon.',
  'news.release.headline': '{promotionId} releases {personId}',
  'news.release.body':
    '{promotionId} has let {personId} go. They are free to talk to any promotion that wants them.',
  'news.departure.headline': '{personId} leaves {promotionId}',
  'news.departure.body':
    '{personId} is no longer with {promotionId}. Where they turn up next is anyone’s guess.',
  'news.walked-out.headline': '{personId} walks out on {promotionId}',
  'news.walked-out.body':
    '{personId} has walked out on {promotionId} and is now a free agent. It is not a parting on good terms.',

  // Rival decisions (AIP1, wired by DAY1-06), told on the day they come out.
  'news.release-refused.headline': '{personId} was refused a release by {promotionId}',
  'news.release-refused.body':
    'Word is out that {personId} asked {promotionId} to be let go and the promotion said no.',
};

registerTextCatalog('news', NEWS_TEXT_CATALOG);
