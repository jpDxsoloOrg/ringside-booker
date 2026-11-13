/**
 * The match aftermath's balance numbers (MTCH3-01): what one match result is worth in popularity.
 *
 * `match.popularity.*` feeds `popularityGain`: the base for a win, loss or draw and how the
 * popularity gap scales it, the event size, pre-show and crowded-match multipliers, the per-match
 * limit, the great match, classic match and win streak bonuses, and how momentum dampens or lifts
 * a gain. Every factor has `min: 0`, so a gain can shrink to 0 but never turns into a loss.
 *
 * See docs/design/match-aftermath.md#popularity-gain.
 */

import { defineTunables } from '../../../core/tunables/define';

const AFTERMATH_CATEGORY = 'Aftermath';
const AFTERMATH_DOC = 'match-aftermath.md#popularity-gain';

function points(defaultValue: number, max: number, description: string) {
  return {
    kind: 'number',
    default: defaultValue,
    min: 0,
    max,
    step: 0.01,
    unit: 'points',
    category: AFTERMATH_CATEGORY,
    description,
    docRef: AFTERMATH_DOC,
  } as const;
}

function multiplier(defaultValue: number, description: string) {
  return {
    kind: 'number',
    default: defaultValue,
    min: 0,
    max: 5,
    step: 0.05,
    unit: 'multiplier',
    category: AFTERMATH_CATEGORY,
    description,
    docRef: AFTERMATH_DOC,
  } as const;
}

function score(defaultValue: number, description: string) {
  return {
    kind: 'number',
    default: defaultValue,
    min: 0,
    max: 100,
    step: 1,
    unit: 'points',
    category: AFTERMATH_CATEGORY,
    description,
    docRef: AFTERMATH_DOC,
  } as const;
}

export const aftermathTunables = defineTunables({
  'match.popularity.winBase': points(1, 10, 'Popularity a win against an equal opponent gives'),
  'match.popularity.winGapPerPoint': points(
    0.12,
    1,
    'Extra popularity for each point the beaten opponent is more popular',
  ),
  'match.popularity.winDownGapPerPoint': points(
    0.04,
    1,
    'Popularity taken off a win for each point the beaten opponent is less popular',
  ),
  'match.popularity.lossBase': points(0.5, 10, 'Popularity a loss costs'),
  'match.popularity.lossGapPerPoint': points(
    0.02,
    1,
    'Extra cost of a loss for each point the winner is less popular',
  ),
  'match.popularity.drawGapPerPoint': points(
    0.03,
    1,
    'Popularity a draw moves for each point of gap to the opponents',
  ),
  'match.popularity.drawMax': points(1, 10, 'Most popularity a draw can gain or cost'),
  'match.popularity.importance.house.gain': multiplier(0.5, 'Gain multiplier at a house show'),
  'match.popularity.importance.house.loss': multiplier(0.5, 'Loss multiplier at a house show'),
  'match.popularity.importance.minor.gain': multiplier(0.75, 'Gain multiplier at a minor show'),
  'match.popularity.importance.minor.loss': multiplier(0.75, 'Loss multiplier at a minor show'),
  'match.popularity.importance.regular.gain': multiplier(1, 'Gain multiplier at a regular show'),
  'match.popularity.importance.regular.loss': multiplier(1, 'Loss multiplier at a regular show'),
  'match.popularity.importance.major.gain': multiplier(1.5, 'Gain multiplier at a major show'),
  'match.popularity.importance.major.loss': multiplier(1, 'Loss multiplier at a major show'),
  'match.popularity.importance.flagship.gain': multiplier(
    2,
    'Gain multiplier at the flagship show',
  ),
  'match.popularity.importance.flagship.loss': multiplier(
    1,
    'Loss multiplier at the flagship show',
  ),
  'match.popularity.crowdedFrom': {
    kind: 'integer',
    default: 6,
    min: 2,
    max: 100,
    unit: 'count',
    category: AFTERMATH_CATEGORY,
    description:
      'Most competitors before a match counts as crowded and each share of popularity shrinks',
    docRef: AFTERMATH_DOC,
  },
  'match.popularity.maxGain': points(4, 20, 'Most popularity one match can give'),
  'match.popularity.maxLoss': points(3, 20, 'Most popularity one match can cost'),
  'match.popularity.greatMatchFrom': score(85, 'Match score that counts as a great match'),
  'match.popularity.greatMatchBonus': points(0.3, 5, 'Popularity bonus for a great match'),
  'match.popularity.classicFrom': score(95, 'Match score that counts as a classic'),
  'match.popularity.classicBonus': points(
    0.3,
    5,
    'Extra popularity bonus for a classic, on top of the great match bonus',
  ),
  'match.popularity.streakPriorWins': {
    kind: 'integer',
    default: 2,
    min: 0,
    max: 20,
    unit: 'count',
    category: AFTERMATH_CATEGORY,
    description: 'Wins in a row before this match needed for a win streak bonus',
    docRef: AFTERMATH_DOC,
  },
  'match.popularity.streakStep': points(
    0.2,
    5,
    'Win streak bonus for each win from the streak threshold on',
  ),
  'match.popularity.streakMax': points(1, 10, 'Most a win streak can add to one match'),
  'match.popularity.streakLookback': {
    kind: 'integer',
    default: 10,
    min: 0,
    max: 50,
    unit: 'count',
    category: AFTERMATH_CATEGORY,
    description: 'How many recent matches are checked when counting a win streak',
    docRef: AFTERMATH_DOC,
  },
  'match.popularity.coldMomentumFactor': {
    kind: 'number',
    default: 0.25,
    min: 0,
    max: 1,
    step: 0.05,
    unit: 'multiplier',
    category: AFTERMATH_CATEGORY,
    description: 'Gain multiplier at the lowest momentum (−100)',
    docRef: AFTERMATH_DOC,
  },
  'match.popularity.neutralMomentumAt': {
    kind: 'number',
    default: 0,
    min: -95,
    max: 95,
    step: 5,
    unit: 'points',
    category: AFTERMATH_CATEGORY,
    description: 'Momentum at and above which gains are not dampened',
    docRef: AFTERMATH_DOC,
  },
  'match.popularity.hotMomentumBonus': {
    kind: 'number',
    default: 0.25,
    min: 0,
    max: 2,
    step: 0.05,
    unit: 'multiplier',
    category: AFTERMATH_CATEGORY,
    description: 'Extra gain multiplier at the highest momentum (+100)',
    docRef: AFTERMATH_DOC,
  },
  'match.popularity.preShowFactor': {
    kind: 'number',
    default: 0.5,
    min: 0,
    max: 1,
    step: 0.05,
    unit: 'multiplier',
    category: AFTERMATH_CATEGORY,
    description: 'Multiplier for a match on the pre-show',
    docRef: AFTERMATH_DOC,
  },
  // MTCH3-03: how a match's change spreads, and how many stored aftermaths each worker keeps.
  'match.popularity.neighbourSpill': {
    kind: 'number',
    default: 0.4,
    min: 0,
    max: 1,
    step: 0.05,
    unit: 'ratio',
    category: AFTERMATH_CATEGORY,
    description: "Share of a match's popularity change each neighbouring region gets",
    docRef: 'match-aftermath.md#regional-spread',
  },
  // MTCH3-05: how much of EVT5's TV reach a match's popularity change gets.
  'match.popularity.tvSpill': {
    kind: 'number',
    default: 0.3,
    min: 0,
    max: 1,
    step: 0.05,
    unit: 'ratio',
    category: AFTERMATH_CATEGORY,
    description:
      "Share of the show's TV reach a match's popularity change gets in TV regions (0 turns it off)",
    docRef: 'match-aftermath.md#integrations',
  },
  'match.aftermath.keepPerPerson': {
    kind: 'integer',
    default: 10,
    min: 1,
    max: 100,
    unit: 'count',
    category: AFTERMATH_CATEGORY,
    description: 'How many recent match aftermaths are kept for each worker',
    docRef: 'match-aftermath.md#stored-aftermaths',
  },
});
