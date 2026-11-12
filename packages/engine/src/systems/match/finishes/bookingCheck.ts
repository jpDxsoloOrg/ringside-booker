/**
 * MTCH2's booking check (EVT2-07): every planned finish on a card fits its match, and on a show
 * whose results Random winners decides nothing is planned at all. It plugs into booking through
 * `registerBookingCheck` (order 200), so booking's own files do not change.
 *
 * Errors (they block Lock):
 *
 * - `randomWinners`: a planned result or finish on a Random winners show.
 * - `finishNotAllowed`: the finish is no longer in the game, or is not allowed for the match's type,
 *   side count and stipulations (`allowedFinishes`), such as after the type changed.
 * - `finishOutcomeMismatch`: the planned result is not the finish's outcome kind (a draw on a
 *   Disqualification).
 * - `methodNotInFinish`: a planned win by a method the finish does not end with.
 *
 * Warning (never blocks):
 *
 * - `finishBlocksTitleChange`: a title match planned as a win for a side without the champion, on
 *   a finish and method where `titleCanChange` is false. The challenger wins the match; the title
 *   stays put.
 *
 * A match with no planned finish ("Auto") is not checked: the finish is picked on the night from
 * the allowed ones. A world without a finish catalog is not checked either.
 *
 * Design: docs/design/match-finishes.md#integration and docs/design/booking.md#integration.
 */

import { finishOf, methodOf, type FinishOutcomeKind } from '../../../model/catalogs';
import type { Segment } from '../../../model/entities/segment';
import type { DeepReadonly } from '../../../model/world';
import { registerBookingCheck } from '../../booking/validate/registry';
import { at, competitorSides, placeOf } from '../../booking/validate/checks/shared';
import type {
  BookingCheck,
  BookingCheckInput,
  BookingIssueDraft,
} from '../../booking/validate/types';
import { finishEffectLabel } from '../formulas/finishEffect';
import { allowedFinishes } from './allowed';
import { randomWinnersActive } from './randomWinners';
import { titleCanChange } from './titleRule';

export const FINISH_BOOKING_CHECK_ID = 'match.finish';

/** The codes this check reports. */
export const FINISH_BOOKING_CODES = {
  randomWinners: 'randomWinners',
  finishNotAllowed: 'finishNotAllowed',
  finishOutcomeMismatch: 'finishOutcomeMismatch',
  methodNotInFinish: 'methodNotInFinish',
  finishBlocksTitleChange: 'finishBlocksTitleChange',
} as const;

const CODES = FINISH_BOOKING_CODES;

const OUTCOME_WORDS: Readonly<Record<FinishOutcomeKind, string>> = {
  win: 'a winner',
  draw: 'a draw',
  noContest: 'a no contest',
};

type MatchSegmentView = Extract<DeepReadonly<Segment>, { kind: 'match' }>;

/** "a Disqualification finish", "an Outside interference finish". */
function aFinish(name: string): string {
  const label = finishEffectLabel(name);
  return `${/^[aeiou]/i.test(label) ? 'an' : 'a'} ${label}`;
}

function randomWinnersIssues(
  input: BookingCheckInput,
  segment: MatchSegmentView,
): BookingIssueDraft[] {
  const place = placeOf(input, segment);
  const issues: BookingIssueDraft[] = [];
  if (segment.outcome !== null) {
    issues.push({
      code: CODES.randomWinners,
      severity: 'error',
      message: `${place}: results on your shows are decided on the night (Random winners)`,
      ...at(segment),
    });
  }
  if (segment.match.finishKey !== null) {
    issues.push({
      code: CODES.randomWinners,
      severity: 'error',
      message: `${place}: finishes on your shows are decided on the night (Random winners)`,
      ...at(segment),
    });
  }
  return issues;
}

/** The title warning: a challenger's planned win that the finish or method keeps from the title. */
function titleIssue(
  input: BookingCheckInput,
  segment: MatchSegmentView,
  finish: NonNullable<ReturnType<typeof finishOf>>,
): BookingIssueDraft | null {
  const { outcome } = segment;
  if (outcome?.kind !== 'win' || segment.match.titleIds.length === 0) {
    return null;
  }
  const winners = new Set(
    competitorSides(input, segment).find((side) => side.side === outcome.winningSide)?.personIds,
  );
  const challenged = segment.match.titleIds.find((titleId) => {
    const reign = input.read.tables.titleReigns.lookupOne('openByTitle', titleId);
    return !(reign?.holderIds ?? []).some((holderId) => winners.has(holderId));
  });
  if (challenged === undefined) {
    return null;
  }
  const method = methodOf(input.read, outcome.methodKey);
  const rule = titleCanChange({
    finish,
    method:
      method === undefined ? null : { name: method.name, changesTitles: method.changesTitles },
  });
  if (rule.value) {
    return null;
  }
  const message = finish.allowsTitleChange
    ? `The title can't change hands by ${method?.name ?? 'that method'}`
    : `The title can't change hands on ${aFinish(finish.name)}`;
  return {
    code: CODES.finishBlocksTitleChange,
    severity: 'warning',
    message,
    ...at(segment),
    titleId: challenged,
  };
}

function finishIssues(input: BookingCheckInput, segment: MatchSegmentView): BookingIssueDraft[] {
  const { finishKey } = segment.match;
  if (finishKey === null) {
    return [];
  }
  const place = placeOf(input, segment);
  const where = at(segment);
  const finish = finishOf(input.read, finishKey);
  if (finish === undefined) {
    return [
      {
        code: CODES.finishNotAllowed,
        severity: 'error',
        message: `${place}: that finish is no longer in the game; pick another or Auto`,
        ...where,
      },
    ];
  }
  const issues: BookingIssueDraft[] = [];
  const sideCount = competitorSides(input, segment).length;
  const allowed = allowedFinishes(input.read.meta.catalogs, {
    matchTypeKey: segment.match.matchTypeKey,
    ...(sideCount >= 2 ? { sideCount } : {}),
    stipulationKeys: segment.match.stipulationKeys,
  });
  if (!allowed.some((entry) => entry.key === finish.key)) {
    issues.push({
      code: CODES.finishNotAllowed,
      severity: 'error',
      message: `${place}: ${aFinish(finish.name)} can't end this match; pick another finish or Auto`,
      ...where,
    });
  }
  const { outcome } = segment;
  if (outcome === null) {
    return issues;
  }
  if (outcome.kind !== finish.outcomeKind) {
    issues.push({
      code: CODES.finishOutcomeMismatch,
      severity: 'error',
      message: `${place}: ${aFinish(finish.name)} ends in ${OUTCOME_WORDS[finish.outcomeKind]}, but the plan is ${OUTCOME_WORDS[outcome.kind]}`,
      ...where,
    });
    return issues;
  }
  if (
    outcome.kind === 'win' &&
    !finish.methods.some((method) => method.methodKey === outcome.methodKey)
  ) {
    const methodName = methodOf(input.read, outcome.methodKey)?.name ?? 'that method';
    issues.push({
      code: CODES.methodNotInFinish,
      severity: 'error',
      message: `${place}: ${aFinish(finish.name)} can't be won by ${methodName}`,
      ...where,
    });
    return issues;
  }
  const title = titleIssue(input, segment, finish);
  if (title !== null) {
    issues.push(title);
  }
  return issues;
}

function run(input: BookingCheckInput): BookingIssueDraft[] {
  if (input.read.meta.catalogs.finishes === undefined) {
    return [];
  }
  const decidedOnTheNight = randomWinnersActive(input.read, {
    promotionId: input.instance.promotionId,
    brandId: input.instance.brandId,
  });
  return input.segments.flatMap((segment) => {
    if (segment.kind !== 'match') {
      return [];
    }
    return decidedOnTheNight ? randomWinnersIssues(input, segment) : finishIssues(input, segment);
  });
}

export const finishBookingCheck: BookingCheck = {
  id: FINISH_BOOKING_CHECK_ID,
  order: 200,
  label: 'Finishes fit their matches',
  run,
};

registerBookingCheck(finishBookingCheck);
