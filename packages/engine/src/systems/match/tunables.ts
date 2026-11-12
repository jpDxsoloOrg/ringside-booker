/**
 * The match system's balance numbers.
 *
 * `match.slot.*` (D-10): how much each slot role counts toward the show score, the duration class
 * each role implies, and the smallest main card that has a semi-main. The main event has no
 * duration class tunable: it is always long. See docs/design/match-rating.md#slots.
 *
 * `match.perf.*`, `match.side(s).*` and `match.workRate.*` (MTCH1-03): the in-ring formulas' weights,
 * penalties, side decays and work rate checks. See docs/design/match-rating.md#worker-performance.
 *
 * `match.starPower.*`, `match.expectation.*`, `match.crowd.*`, `match.compression.*`,
 * `match.blend.*`, `match.stars.*` and `match.angle.*` (MTCH1-04): the crowd half of a rating (D-02),
 * soft compression, the segment score blend, star ratings and the simple talking segment score.
 * See docs/design/match-rating.md#star-power.
 *
 * `match.finish.*` and `match.autoFinish.*` (MTCH2-02): how strongly a finish's catalog effects move
 * work rate and crowd, the crowd's draw penalty and how often a heel winner cheats. See
 * docs/design/match-finishes.md#finish-effects.
 *
 * `match.autoWinner.*` and `match.randomWinners.*` (MTCH2-03): the auto-winner's weights, push and
 * alignment points and unpredictability. See docs/design/match-finishes.md#auto-winner.
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

// Crowd, scoring, stars and talking segments (MTCH1-04).
const CROWD_CATEGORY = 'Match: crowd';
const SCORING_CATEGORY = 'Match: scoring';
const STARS_CATEGORY = 'Match: stars';
const TALKING_CATEGORY = 'Match: talking segments';
const STAR_POWER_DOC = 'match-rating.md#star-power';
const EXPECTATION_DOC = 'match-rating.md#crowd-and-expectation-d-02';
const COMPRESSION_DOC = 'match-rating.md#soft-compression';
const SEGMENT_SCORE_DOC = 'match-rating.md#segment-score';
const STARS_DOC = 'match-rating.md#star-ratings';
const TALKING_DOC = 'match-rating.md#talking-segments-simple';

const SHARE_RANGE = { min: 0, max: 1, step: 0.05 };
const OFFSET_RANGE = { min: -30, max: 30, step: 1 };
const VARIANCE_SD_RANGE = { min: 0, max: 20, step: 0.5 };

/** A weight or share, 0..1. */
function share(defaultValue: number, category: string, docRef: string, description: string) {
  return matchNumber(defaultValue, SHARE_RANGE, 'ratio', category, docRef, description);
}

/** A flat change to what the crowd expects, in points, −30..30. */
function expectationOffset(defaultValue: number, description: string) {
  return matchNumber(
    defaultValue,
    OFFSET_RANGE,
    'points',
    CROWD_CATEGORY,
    EXPECTATION_DOC,
    description,
  );
}

/** The share of work rate in a match's segment score for one promotion style. */
function workRateShare(defaultValue: number, styleName: string) {
  return share(
    defaultValue,
    SCORING_CATEGORY,
    SEGMENT_SCORE_DOC,
    `Share of work rate in a match's score at a ${styleName} promotion; the crowd gets the rest`,
  );
}

/** The most stars a segment can get, 0..5 in quarter stars. */
function starCap(defaultValue: number, description: string) {
  return {
    kind: 'number',
    default: defaultValue,
    min: 0,
    max: 5,
    step: 0.25,
    unit: 'stars',
    category: STARS_CATEGORY,
    description,
    docRef: STARS_DOC,
  } as const;
}

const RESULTS_CATEGORY = 'Match results';
const FINISH_EFFECTS_DOC = 'match-finishes.md#finish-effects';
const FINISH_ON_THE_NIGHT_DOC = 'match-finishes.md#finish-on-the-night';
const AUTO_WINNER_DOC = 'match-finishes.md#auto-winner';
const RANDOM_WINNERS_DOC = 'match-finishes.md#random-winners';

/** Auto-winner points for one push level (MTCH2-03). */
function pushPoints(defaultPoints: number, level: string) {
  return matchNumber(
    defaultPoints,
    { min: 0, max: 100, step: 1 },
    'points',
    RESULTS_CATEGORY,
    AUTO_WINNER_DOC,
    `Auto-winner points for a worker pushed ${level}`,
  );
}

/** Auto-winner points for one alignment (MTCH2-03). */
function alignmentEdge(defaultPoints: number, alignment: string) {
  return matchNumber(
    defaultPoints,
    { min: -20, max: 20, step: 0.5 },
    'points',
    RESULTS_CATEGORY,
    AUTO_WINNER_DOC,
    `Auto-winner points for a ${alignment}`,
  );
}

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
  // Crowd, scoring, stars and talking segments (MTCH1-04). See docs/design/match-rating.md.
  'match.starPower.depthDecay': matchNumber(
    0.5,
    SHARE_RANGE,
    'ratio',
    CROWD_CATEGORY,
    STAR_POWER_DOC,
    'How much each next-most-popular worker adds to star power; 0 counts only the biggest star',
  ),
  'match.starPower.curve': share(
    0.8,
    CROWD_CATEGORY,
    STAR_POWER_DOC,
    'Diminishing returns at the top of star power; 0 makes star power plain popularity',
  ),
  'match.expectation.base': matchNumber(
    25,
    { min: 0, max: 100, step: 1 },
    'points',
    CROWD_CATEGORY,
    EXPECTATION_DOC,
    'What a crowd expects from anyone before star power, momentum and the slot',
  ),
  'match.expectation.starWeight': share(
    0.5,
    CROWD_CATEGORY,
    EXPECTATION_DOC,
    'How much star power raises what the crowd expects',
  ),
  'match.expectation.momentumWeight': share(
    0.1,
    CROWD_CATEGORY,
    EXPECTATION_DOC,
    'How much momentum with the promotion raises (or lowers) what the crowd expects',
  ),
  'match.expectation.slot.preShow': expectationOffset(-8, 'Expectation change on the pre-show'),
  'match.expectation.slot.opener': expectationOffset(-3, 'Expectation change for the opener'),
  'match.expectation.slot.midcard': expectationOffset(0, 'Expectation change in the midcard'),
  'match.expectation.slot.semiMain': expectationOffset(4, 'Expectation change for the semi-main'),
  'match.expectation.slot.mainEvent': expectationOffset(8, 'Expectation change for the main event'),
  'match.expectation.importance.house': expectationOffset(-6, 'Expectation change at a house show'),
  'match.expectation.importance.minor': expectationOffset(
    -3,
    'Expectation change at a minor event',
  ),
  'match.expectation.importance.regular': expectationOffset(
    0,
    'Expectation change at a regular event',
  ),
  'match.expectation.importance.major': expectationOffset(4, 'Expectation change at a major event'),
  'match.expectation.importance.flagship': expectationOffset(
    8,
    'Expectation change at a flagship event',
  ),
  'match.expectation.televised': expectationOffset(2, 'Expectation change when the show is on TV'),
  'match.crowd.performanceWeight': share(
    0.55,
    CROWD_CATEGORY,
    EXPECTATION_DOC,
    'Weight of work rate (or talk) in what the crowd thinks was delivered',
  ),
  'match.crowd.entertainmentWeight': share(
    0.25,
    CROWD_CATEGORY,
    EXPECTATION_DOC,
    'Weight of entertainment in what the crowd thinks was delivered',
  ),
  'match.crowd.starWeight': share(
    0.2,
    CROWD_CATEGORY,
    EXPECTATION_DOC,
    'Weight of star power in what the crowd thinks was delivered',
  ),
  'match.crowd.surpriseWeight': share(
    0.5,
    CROWD_CATEGORY,
    EXPECTATION_DOC,
    'How much beating or missing expectation moves the crowd; 0 ignores expectation',
  ),
  'match.crowd.varianceSd': matchNumber(
    3,
    VARIANCE_SD_RANGE,
    'points',
    CROWD_CATEGORY,
    EXPECTATION_DOC,
    'Spread of the crowd-on-the-night roll; 0 turns the variance off',
  ),
  'match.compression.knee': matchNumber(
    85,
    { min: 50, max: 100, step: 1 },
    'points',
    SCORING_CATEGORY,
    COMPRESSION_DOC,
    'Where soft compression starts; 100 turns it off inside the scale',
  ),
  'match.compression.factor': share(
    0.4,
    SCORING_CATEGORY,
    COMPRESSION_DOC,
    'How much of each point above the knee is kept; 0 flattens everything above it, 1 keeps it all',
  ),
  'match.blend.workRateShare.mainstream': workRateShare(0.45, 'mainstream'),
  'match.blend.workRateShare.traditional': workRateShare(0.5, 'traditional'),
  'match.blend.workRateShare.technical': workRateShare(0.65, 'technical'),
  'match.blend.workRateShare.hardHitting': workRateShare(0.6, 'hard-hitting'),
  'match.blend.workRateShare.hardcore': workRateShare(0.5, 'hardcore'),
  'match.blend.workRateShare.highFlying': workRateShare(0.6, 'high-flying'),
  'match.blend.workRateShare.entertainment': workRateShare(0.3, 'entertainment'),
  'match.stars.performanceShare': share(
    0.7,
    STARS_CATEGORY,
    STARS_DOC,
    'Share of work rate (or talk) in a star rating; the crowd gets the rest',
  ),
  'match.stars.zeroAt': matchNumber(
    35,
    { min: 0, max: 80, step: 1 },
    'points',
    STARS_CATEGORY,
    STARS_DOC,
    'The blended score that is worth no stars at all',
  ),
  'match.stars.pointsPerStar': matchNumber(
    12,
    { min: 0, max: 30, step: 0.5 },
    'points',
    STARS_CATEGORY,
    STARS_DOC,
    'Points of blended score above the zero for each star; 0 gives every segment above it the cap',
  ),
  'match.stars.cap.short': starCap(3.5, 'The most stars a short match can get'),
  'match.stars.cap.standard': starCap(4.75, 'The most stars a standard match can get'),
  'match.stars.cap.long': starCap(5, 'The most stars a long match can get'),
  'match.stars.cap.angle': starCap(4, 'The most stars a talking segment can get'),
  'match.angle.talkShare': share(
    0.35,
    TALKING_CATEGORY,
    SEGMENT_SCORE_DOC,
    "Share of talk in a talking segment's score; the crowd gets the rest",
  ),
  'match.angle.varianceSd': matchNumber(
    4,
    VARIANCE_SD_RANGE,
    'points',
    TALKING_CATEGORY,
    TALKING_DOC,
    'Spread of the how-the-promo-landed roll; 0 turns the variance off',
  ),
  'match.finish.effectScale': matchNumber(
    1,
    { min: 0, max: 3, step: 0.05 },
    'multiplier',
    RESULTS_CATEGORY,
    FINISH_EFFECTS_DOC,
    'How strongly a finish changes work rate and crowd',
  ),
  'match.finish.drawCrowdPenalty': matchNumber(
    2,
    { min: 0, max: 20, step: 0.5 },
    'points',
    RESULTS_CATEGORY,
    FINISH_EFFECTS_DOC,
    'Crowd lost when a match ends without a winner',
  ),
  'match.autoFinish.heelCheatingFactor': matchNumber(
    2,
    { min: 0, max: 10, step: 0.1 },
    'multiplier',
    RESULTS_CATEGORY,
    FINISH_ON_THE_NIGHT_DOC,
    "How much more often a heel winner's finish is a cheating one",
  ),
  // MTCH2-03: the auto-winner and Random winners. See docs/design/match-finishes.md#auto-winner.
  'match.autoWinner.popularityWeight': matchNumber(
    0.6,
    { min: 0, max: 3, step: 0.05 },
    'multiplier',
    RESULTS_CATEGORY,
    AUTO_WINNER_DOC,
    "Auto-winner points per point of a side's mean popularity in the show's region",
  ),
  'match.autoWinner.momentumWeight': matchNumber(
    0.15,
    { min: 0, max: 1, step: 0.01 },
    'multiplier',
    RESULTS_CATEGORY,
    AUTO_WINNER_DOC,
    "Auto-winner points per point of a side's mean momentum",
  ),
  'match.autoWinner.push.mainEvent': pushPoints(30, 'as a main eventer'),
  'match.autoWinner.push.upperCard': pushPoints(22, 'on the upper card'),
  'match.autoWinner.push.midCard': pushPoints(14, 'on the mid card'),
  'match.autoWinner.push.lowerCard': pushPoints(7, 'on the lower card'),
  'match.autoWinner.push.enhancement': pushPoints(0, 'as enhancement talent'),
  'match.autoWinner.push.none': pushPoints(0, 'not at all'),
  'match.autoWinner.alignment.face': alignmentEdge(2, 'face'),
  'match.autoWinner.alignment.heel': alignmentEdge(0, 'heel'),
  'match.autoWinner.alignment.tweener': alignmentEdge(1, 'tweener'),
  'match.autoWinner.randomness': matchNumber(
    5,
    { min: 0, max: 200, step: 0.5 },
    'points',
    RESULTS_CATEGORY,
    AUTO_WINNER_DOC,
    'Most unpredictability added to each side of an auto-winner match; 0 = always the same winner',
  ),
  'match.randomWinners.randomness': matchNumber(
    60,
    { min: 1, max: 1000, step: 1 },
    'points',
    RESULTS_CATEGORY,
    RANDOM_WINNERS_DOC,
    'Most unpredictability added to each side in Random winners mode; at least 1, so it is never fully predictable',
  ),
});
