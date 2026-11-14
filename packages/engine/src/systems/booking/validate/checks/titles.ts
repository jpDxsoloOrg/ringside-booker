/**
 * The title checks (errors): every title on the line is set up so the show can decide it.
 *
 * - `titleNotAllowed`: the match type has `allowsTitles: false` (a battle royal).
 * - `titleTwiceOnCard`: the title is already on the line in an earlier match of this card.
 * - `titleRetired`: the title has been retired.
 * - `championMissing`: a holder of the title's open reign is not a competitor. A vacant title has
 *   no holders to check.
 * - `titleSideSize`: a competitor side does not have exactly the title's `holderCount` people.
 *
 * Design notes: docs/design/booking.md#validation.
 */

import type { TitleId } from '../../../../core/ids';
import { matchTypeOf } from '../../../../model/catalogs';
import type { Segment } from '../../../../model/entities/segment';
import type { DeepReadonly } from '../../../../model/world';
import { currentHolders } from '../../../titles/helpers/holders';
import type { BookingCheck, BookingCheckInput, BookingIssueDraft } from '../types';
import { at, competitorSides, nameOf, placeOf, plural, theTitle } from './shared';

export const TITLES_CHECK_ID = 'booking.titles';

function titleIssues(input: BookingCheckInput): BookingIssueDraft[] {
  const { read } = input;
  const issues: BookingIssueDraft[] = [];
  const firstMatchOf = new Map<TitleId, DeepReadonly<Segment>>();
  for (const segment of input.segments) {
    if (segment.kind !== 'match' || segment.match.titleIds.length === 0) {
      continue;
    }
    const where = at(segment);
    const place = placeOf(input, segment);
    const matchType = matchTypeOf(read, segment.match.matchTypeKey);
    if (matchType !== undefined && !matchType.allowsTitles) {
      issues.push({
        code: 'titleNotAllowed',
        severity: 'error',
        message: `${place}: titles can't be on the line in a ${matchType.name}`,
        ...where,
      });
    }
    const sides = competitorSides(input, segment);
    const competitors = new Set(sides.flatMap((side) => side.personIds));
    for (const titleId of segment.match.titleIds) {
      const title = read.tables.titles.get(titleId);
      if (title === undefined) {
        continue;
      }
      const onTitle = { ...where, titleId };
      const titleName = theTitle(title.name);
      const earlier = firstMatchOf.get(titleId);
      if (earlier === undefined) {
        firstMatchOf.set(titleId, segment);
      } else {
        issues.push({
          code: 'titleTwiceOnCard',
          severity: 'error',
          message: `${titleName} is already on the line in ${placeOf(input, earlier)}`,
          ...onTitle,
        });
      }
      if (title.status === 'retired') {
        issues.push({
          code: 'titleRetired',
          severity: 'error',
          message: `${titleName} has been retired`,
          ...onTitle,
        });
      }
      for (const holderId of currentHolders(read, titleId)) {
        if (!competitors.has(holderId)) {
          issues.push({
            code: 'championMissing',
            severity: 'error',
            message: `The champion ${nameOf(input, holderId)} isn't in this match`,
            ...onTitle,
            personId: holderId,
          });
        }
      }
      const { holderCount } = title;
      if (sides.some((side) => side.personIds.length !== holderCount)) {
        issues.push({
          code: 'titleSideSize',
          severity: 'error',
          message: `${titleName} needs ${String(holderCount)} ${plural(holderCount, 'wrestler', 'wrestlers')} on each side`,
          ...onTitle,
        });
      }
    }
  }
  return issues;
}

export const titlesCheck: BookingCheck = {
  id: TITLES_CHECK_ID,
  order: 130,
  run: titleIssues,
};
