/**
 * Expected push: where on the card a worker would expect to be at a given promotion.
 *
 * It compares how well known the worker is among the promotion's fans with how well known the
 * promotion itself is to them. The same worker expects more from a small promotion than from a big
 * one, and the expectation moves smoothly with the promotion's popularity instead of jumping at
 * size tiers. Crew are never pushed.
 *
 * Design: docs/design/workers.md#expected-push.
 */

import { startCalc, startDecision, type Traced } from '../../../core/trace';
import type { EmploymentRole, Push } from '../../../model/entities/employment';
import type { EngineTunables, TunableKey } from '../../tunables';
import { formatNumber } from '../../world/people/labels';
import {
  EXPECTED_PUSH_DOC_REF,
  fanBaseOf,
  footprintPopularity,
  NO_FANS_NOTE,
  type FootprintRegion,
  type FootprintRegionalPop,
} from './footprintPopularity';

export interface ExpectedPushInputs {
  /** The job the worker has, or would have, at the promotion. */
  employmentRole: EmploymentRole;
  workerPop: FootprintRegionalPop;
  promotionPop: FootprintRegionalPop;
  promotionName: string;
  regions: readonly FootprintRegion[];
}

/** The jobs that have no card position. */
export const CREW_ROLES = [
  'referee',
  'announcer',
  'producer',
  'presenter',
  'booker',
] as const satisfies readonly EmploymentRole[];

export const CREW_NOT_PUSHED_RULE = 'Crew are not pushed';
export const STAR_REASON = 'A star anywhere';

/** The card positions as the player reads them. */
export const PUSH_LABELS: Readonly<Record<Push, string>> = {
  mainEvent: 'Main event',
  upperCard: 'Upper card',
  midCard: 'Mid card',
  lowerCard: 'Lower card',
  enhancement: 'Enhancement',
  none: 'None',
};

/** The positions a standing can earn, top down, with the tunable each one starts at. */
const PUSH_BANDS: readonly {
  readonly push: Exclude<Push, 'enhancement' | 'none'>;
  readonly ratioKey: TunableKey & `workers.expectedPush.${string}Ratio`;
}[] = [
  { push: 'mainEvent', ratioKey: 'workers.expectedPush.mainEventRatio' },
  { push: 'upperCard', ratioKey: 'workers.expectedPush.upperCardRatio' },
  { push: 'midCard', ratioKey: 'workers.expectedPush.midCardRatio' },
  { push: 'lowerCard', ratioKey: 'workers.expectedPush.lowerCardRatio' },
];

function isCrewRole(role: EmploymentRole): boolean {
  return CREW_ROLES.some((crewRole) => crewRole === role);
}

/** A worker's standing at a promotion, with the popularity it was worked out from. */
export interface PushStanding {
  /** The worker's popularity among the promotion's fans. */
  readonly workerPopularity: Traced<number>;
  /** The promotion's own popularity among its fans. */
  readonly promotionPopularity: Traced<number>;
  /** `workerPopularity ÷ max(promotionPopularity, workers.expectedPush.minPromotionPop)`. */
  readonly standing: Traced<number>;
}

/**
 * A worker's standing at a promotion: their popularity among its fans divided by the promotion's
 * own popularity among them. 1 means "as well known as the promotion itself". The promotion's side
 * is never read as less than `workers.expectedPush.minPromotionPop`, so a promotion nobody has
 * heard of does not turn every worker into a headliner.
 *
 * Returns null when the promotion has no fans anywhere, because there is nothing to stand against.
 */
export function pushStanding(
  inputs: Omit<ExpectedPushInputs, 'employmentRole'>,
  deps: { tunables: EngineTunables },
): PushStanding | null {
  const fanBase = fanBaseOf(
    inputs.promotionPop,
    inputs.regions,
    deps.tunables.get('workers.expectedPush.footprintMinPop'),
  );
  if (fanBase.members.length === 0) {
    return null;
  }
  const shared = {
    promotionPop: inputs.promotionPop,
    promotionName: inputs.promotionName,
    regions: inputs.regions,
  };
  const workerPopularity = footprintPopularity({ ...shared, subjectPop: inputs.workerPop }, deps);
  const promotionPopularity = footprintPopularity(
    { ...shared, subjectPop: inputs.promotionPop },
    deps,
  );

  const measuredAgainst = startCalc(
    `${inputs.promotionName}'s popularity with its own fans`,
    promotionPopularity,
    { unit: 'points', docRef: EXPECTED_PUSH_DOC_REF },
  );
  const smallest = measuredAgainst.tunable(
    deps.tunables,
    'workers.expectedPush.minPromotionPop',
    'Lowest promotion popularity counted',
  );
  measuredAgainst.max('Never counted as less than this', smallest);
  if (measuredAgainst.current <= 0) {
    // Only reachable with the floor overridden to 0 and popularity too small to tell from 0.
    return null;
  }

  const standing = startCalc(`Standing at ${inputs.promotionName}`, workerPopularity, {
    unit: 'ratio',
    docRef: EXPECTED_PUSH_DOC_REF,
  })
    .divide(`${inputs.promotionName}'s own popularity there`, measuredAgainst.done())
    .done();
  return { workerPopularity, promotionPopularity, standing };
}

/**
 * The card position a worker would expect at a promotion.
 *
 * 1. Crew (referee, announcer, producer, presenter, booker) expect `none`.
 * 2. A promotion with no fans gives `enhancement`: nobody is a draw there yet.
 * 3. A worker whose popularity among the promotion's fans reaches `workers.expectedPush.starPop`
 *    expects the main event anywhere.
 * 4. Otherwise the first position, top down, whose threshold the worker's standing
 *    ({@link pushStanding}) reaches; anyone below the lower card expects enhancement work.
 *
 * The thresholds are checked top down, so one set out of order by an override makes a position
 * unreachable and never throws.
 */
export function expectedPush(
  inputs: ExpectedPushInputs,
  deps: { tunables: EngineTunables },
): Traced<Push> {
  const decision = startDecision<Push>('Expected push', { docRef: EXPECTED_PUSH_DOC_REF });
  const crew = isCrewRole(inputs.employmentRole);
  decision.rule(CREW_NOT_PUSHED_RULE, crew);
  if (crew) {
    return decision.choose('none', CREW_NOT_PUSHED_RULE);
  }

  const result = pushStanding(inputs, deps);
  if (result === null) {
    decision.note(NO_FANS_NOTE);
    return decision.choose('enhancement', NO_FANS_NOTE);
  }
  const { workerPopularity, standing } = result;
  const popularityText = formatNumber(workerPopularity.value);
  const standingText = formatNumber(standing.value);

  const starPop = decision.tunable(
    deps.tunables,
    'workers.expectedPush.starPop',
    'Popularity of a star anywhere',
  );
  const isStar = workerPopularity.value >= starPop;
  decision.rule(
    `Popularity of ${popularityText} among ${inputs.promotionName}'s fans is at least ${formatNumber(starPop)}`,
    isStar,
  );

  let earned: Push | null = null;
  let because = '';
  for (const [index, { push, ratioKey }] of PUSH_BANDS.entries()) {
    const label = PUSH_LABELS[push];
    const threshold = decision.tunable(deps.tunables, ratioKey, `${label} starts at a standing of`);
    const reason = `Needs a standing of at least ${formatNumber(threshold)}`;
    // The standing's own trace is shown once, under the first position it is checked against.
    decision.consider(push, index === 0 ? standing : standing.value, reason);
    if (earned === null && standing.value >= threshold) {
      earned = push;
      because = `A standing of ${standingText} at ${inputs.promotionName} reaches the ${label.toLowerCase()} mark of ${formatNumber(threshold)}`;
    }
  }
  decision.consider('enhancement', standing.value, 'Anyone below the lower card');

  if (isStar) {
    return decision.choose('mainEvent', STAR_REASON);
  }
  if (earned === null) {
    return decision.choose(
      'enhancement',
      `A standing of ${standingText} at ${inputs.promotionName} is below every card position`,
    );
  }
  return decision.choose(earned, because);
}
