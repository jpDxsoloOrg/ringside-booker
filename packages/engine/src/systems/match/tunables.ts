/**
 * The match system's balance numbers.
 *
 * `match.slot.*` (D-10): how much each slot role counts toward the show score, the duration class
 * each role implies, and the smallest main card that has a semi-main. The main event has no
 * duration class tunable: it is always long. See docs/design/match-rating.md#slots.
 *
 * `match.perf.*`, `match.side(s).*` and `match.workRate.*` (MTCH1-03): the in-ring formulas' weights,
 * penalties, side decays and work rate checks. See docs/design/match-rating.md#worker-performance.
 */

import { defineTunables } from '../../core/tunables/define';
import { DURATION_CLASSES } from './slots';

const SLOTS_CATEGORY = 'Match: slots';
const SLOTS_DOC = 'match-rating.md#slots';

function slotWeight(defaultWeight: number, description: string) {
  return {
    kind: 'number',
    default: defaultWeight,
    min: 0,
    max: 5,
    step: 0.05,
    unit: 'multiplier',
    category: SLOTS_CATEGORY,
    description,
    docRef: SLOTS_DOC,
  } as const;
}

function durationClass(defaultClass: (typeof DURATION_CLASSES)[number], description: string) {
  return {
    kind: 'enum',
    default: defaultClass,
    options: DURATION_CLASSES,
    unit: 'choice',
    category: SLOTS_CATEGORY,
    description,
    docRef: SLOTS_DOC,
  } as const;
}

const PERFORMANCE_CATEGORY = 'Match: performance';
const PERFORMANCE_DOC = 'match-rating.md#worker-performance';
const SIDES_DOC = 'match-rating.md#sides';
const WORK_RATE_CATEGORY = 'Match: work rate';
const WORK_RATE_DOC = 'match-rating.md#work-rate';

function matchNumber(
  defaultValue: number,
  range: { min: number; max: number; step: number },
  unit: 'ratio' | 'points' | 'multiplier',
  category: string,
  docRef: string,
  description: string,
) {
  return {
    kind: 'number',
    default: defaultValue,
    min: range.min,
    max: range.max,
    step: range.step,
    unit,
    category,
    description,
    docRef,
  } as const;
}

/** One attribute's weight in a worker's performance: 0..1, a share of the weighted mean. */
function perfWeight(defaultWeight: number, description: string) {
  return matchNumber(
    defaultWeight,
    { min: 0, max: 1, step: 0.05 },
    'ratio',
    PERFORMANCE_CATEGORY,
    PERFORMANCE_DOC,
    description,
  );
}

/** A flat bonus or penalty on a worker's performance, in points. */
function perfPoints(defaultPoints: number, description: string) {
  return matchNumber(
    defaultPoints,
    { min: 0, max: 50, step: 1 },
    'points',
    PERFORMANCE_CATEGORY,
    PERFORMANCE_DOC,
    description,
  );
}

/** How fast the weights fall from the best member down: 0 counts only the best, 1 is a mean. */
function depthDecay(defaultDecay: number, description: string) {
  return matchNumber(
    defaultDecay,
    { min: 0, max: 1, step: 0.05 },
    'ratio',
    PERFORMANCE_CATEGORY,
    SIDES_DOC,
    description,
  );
}

function workRateNumber(
  defaultValue: number,
  range: { min: number; max: number; step: number },
  unit: 'ratio' | 'points' | 'multiplier',
  description: string,
) {
  return matchNumber(defaultValue, range, unit, WORK_RATE_CATEGORY, WORK_RATE_DOC, description);
}

const NEED_RANGE = { min: 0, max: 100, step: 1 };
const PER_POINT_RANGE = { min: 0, max: 2, step: 0.05 };
const SPREAD_RANGE = { min: 0, max: 2, step: 0.05 };

export const matchTunables = defineTunables({
  'match.slot.weight.preShow': slotWeight(
    0.4,
    'How much a pre-show segment counts toward the show score; 0 makes it count for nothing',
  ),
  'match.slot.weight.opener': slotWeight(
    0.9,
    'How much the opener counts toward the show score; 0 makes it count for nothing',
  ),
  'match.slot.weight.midcard': slotWeight(
    1,
    'How much a midcard segment counts toward the show score; 0 makes it count for nothing',
  ),
  'match.slot.weight.semiMain': slotWeight(
    1.25,
    'How much the semi-main counts toward the show score; 0 makes it count for nothing',
  ),
  'match.slot.weight.mainEvent': slotWeight(
    1.75,
    'How much the main event counts toward the show score; it never weighs less than another slot',
  ),
  'match.slot.durationClass.preShow': durationClass(
    'short',
    'Duration class of a pre-show segment before its match type shifts it',
  ),
  'match.slot.durationClass.opener': durationClass(
    'standard',
    'Duration class of the opener before its match type shifts it',
  ),
  'match.slot.durationClass.midcard': durationClass(
    'standard',
    'Duration class of a midcard segment before its match type shifts it',
  ),
  'match.slot.durationClass.semiMain': durationClass(
    'standard',
    'Duration class of the semi-main before its match type shifts it',
  ),
  'match.slot.semiMainFromSlots': {
    kind: 'integer',
    default: 4,
    min: 3,
    max: 12,
    unit: 'count',
    category: SLOTS_CATEGORY,
    description: 'Smallest main card that has a semi-main; smaller cards have only midcard slots',
    docRef: SLOTS_DOC,
  },
  // Worker performance, sides and work rate (MTCH1-03). See docs/design/match-rating.md.
  'match.perf.inRing.ringwork': perfWeight(
    0.5,
    "Weight of ringwork in a worker's in-ring performance",
  ),
  'match.perf.inRing.psychology': perfWeight(
    0.2,
    "Weight of psychology in a worker's in-ring performance",
  ),
  'match.perf.inRing.athleticism': perfWeight(
    0.2,
    "Weight of athleticism in a worker's in-ring performance",
  ),
  'match.perf.inRing.safety': perfWeight(0.1, "Weight of safety in a worker's in-ring performance"),
  'match.perf.entertainment.charisma': perfWeight(
    0.5,
    "Weight of charisma in a worker's entertainment performance",
  ),
  'match.perf.entertainment.presence': perfWeight(
    0.3,
    "Weight of presence in a worker's entertainment performance",
  ),
  'match.perf.entertainment.mic': perfWeight(
    0.2,
    "Weight of mic skill in a worker's entertainment performance",
  ),
  'match.perf.styleAffinityBonus': perfPoints(
    3,
    'In-ring bonus for a worker whose style suits the match type; 0 turns it off',
  ),
  'match.perf.nonWrestlerPenalty': perfPoints(
    20,
    'In-ring penalty for someone who is not a wrestler at all; 0 turns it off',
  ),
  'match.perf.injuredPenalty': perfPoints(25, 'In-ring penalty for working hurt; 0 turns it off'),
  'match.perf.fatiguePenaltyPerPoint': matchNumber(
    0.15,
    { min: 0, max: 1, step: 0.05 },
    'ratio',
    PERFORMANCE_CATEGORY,
    PERFORMANCE_DOC,
    'Performance lost per point of fatigue; 0 means fatigue costs nothing',
  ),
  'match.side.depthDecay': depthDecay(
    0.55,
    'How much each next-best worker on a side counts; 0 counts only the best, 1 is a plain mean',
  ),
  'match.sides.depthDecay': depthDecay(
    0.7,
    'How much each next-best side counts in the match; 0 counts only the best, 1 is a plain mean',
  ),
  'match.workRate.staminaNeed.short': workRateNumber(
    0,
    NEED_RANGE,
    'points',
    'Stamina a short match asks of a worker in a singles match; 0 means no check fails',
  ),
  'match.workRate.staminaNeed.standard': workRateNumber(
    40,
    NEED_RANGE,
    'points',
    'Stamina a standard match asks of a worker in a singles match',
  ),
  'match.workRate.staminaNeed.long': workRateNumber(
    65,
    NEED_RANGE,
    'points',
    'Stamina a long match asks of a worker in a singles match',
  ),
  'match.workRate.sharedLoadExponent': workRateNumber(
    0.5,
    { min: 0, max: 2, step: 0.05 },
    'ratio',
    'How much bigger matches share the load; 0 means everyone carries the full stamina need',
  ),
  'match.workRate.staminaPenaltyPerPoint': workRateNumber(
    0.4,
    PER_POINT_RANGE,
    'ratio',
    'Performance lost per point of stamina below the need; 0 turns the check off',
  ),
  'match.workRate.psychologyNeed.short': workRateNumber(
    20,
    NEED_RANGE,
    'points',
    'Psychology the leader of a short match needs',
  ),
  'match.workRate.psychologyNeed.standard': workRateNumber(
    45,
    NEED_RANGE,
    'points',
    'Psychology the leader of a standard match needs',
  ),
  'match.workRate.psychologyNeed.long': workRateNumber(
    70,
    NEED_RANGE,
    'points',
    'Psychology the leader of a long match needs',
  ),
  'match.workRate.psychologyPenaltyPerPoint': workRateNumber(
    0.5,
    PER_POINT_RANGE,
    'ratio',
    'Work rate lost per point of psychology the leader is short; 0 turns the check off',
  ),
  'match.workRate.spread.short': workRateNumber(
    0.8,
    SPREAD_RANGE,
    'multiplier',
    'How far a short match can stray from 50; 0 makes every short match a 50',
  ),
  'match.workRate.spread.standard': workRateNumber(
    1,
    SPREAD_RANGE,
    'multiplier',
    'How far a standard match can stray from 50; 0 makes every standard match a 50',
  ),
  'match.workRate.spread.long': workRateNumber(
    1.15,
    SPREAD_RANGE,
    'multiplier',
    'How far a long match can stray from 50; 0 makes every long match a 50',
  ),
  'match.workRate.varianceSd': workRateNumber(
    4,
    { min: 0, max: 20, step: 0.5 },
    'points',
    'Spread of the night-to-night work rate roll; 0 turns the variance off',
  ),
});
