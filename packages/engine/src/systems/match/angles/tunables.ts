/**
 * The beat formulas' balance numbers (MTCH5-02), category `Angles`. How much a manager's talking
 * counts when they stand in, how much popularity counts as a stat, how far low morale and momentum
 * pull a stat down (and good momentum lifts it), and the two noise rolls. MTCH5-03 added the beat
 * limits per duration class and the angle score's keys (closing beat, repetition, crowd blend and
 * the writing band). Design: docs/design/angle-rating.md#beat-worker-value, #beat-score,
 * #beat-limits and #angle-score.
 */

import { defineTunables } from '../../../core/tunables/define';
import { MAX_ANGLE_BEATS } from '../../../model/entities/segment';

export const ANGLES_TUNABLE_CATEGORY = 'Angles';

const WORKER_VALUE_DOC = 'angle-rating.md#beat-worker-value';
const BEAT_SCORE_DOC = 'angle-rating.md#beat-score';
const BEAT_LIMIT_DOC = 'angle-rating.md#beat-limits';
const ANGLE_SCORE_DOC = 'angle-rating.md#angle-score';

function share(defaultValue: number, max: number, docRef: string, description: string) {
  return {
    kind: 'number',
    default: defaultValue,
    min: 0,
    max,
    step: 0.01,
    unit: 'ratio',
    category: ANGLES_TUNABLE_CATEGORY,
    description,
    docRef,
  } as const;
}

function noise(defaultValue: number, max: number, docRef: string, description: string) {
  return {
    kind: 'integer',
    default: defaultValue,
    min: 0,
    max,
    unit: 'points',
    category: ANGLES_TUNABLE_CATEGORY,
    description,
    docRef,
  } as const;
}

/** Beats an angle may have in a slot of one duration class; never above the schema's 8. */
function maxBeats(defaultValue: number, className: string) {
  return {
    kind: 'integer',
    default: defaultValue,
    min: 1,
    max: MAX_ANGLE_BEATS,
    unit: 'count',
    category: ANGLES_TUNABLE_CATEGORY,
    description: `Most beats an angle may have in a ${className} slot`,
    docRef: BEAT_LIMIT_DOC,
  } as const;
}

function factor(
  defaultValue: number,
  min: number,
  max: number,
  unit: 'multiplier' | 'ratio',
  description: string,
) {
  return {
    kind: 'number',
    default: defaultValue,
    min,
    max,
    step: 0.01,
    unit,
    category: ANGLES_TUNABLE_CATEGORY,
    description,
    docRef: ANGLE_SCORE_DOC,
  } as const;
}

function writingPoints(defaultValue: number, max: number, step: number, description: string) {
  return {
    kind: 'number',
    default: defaultValue,
    min: 0,
    max,
    step,
    unit: 'points',
    category: ANGLES_TUNABLE_CATEGORY,
    description,
    docRef: ANGLE_SCORE_DOC,
  } as const;
}

export const angleTunables = defineTunables({
  'match.angle.managerShare': share(
    0.85,
    1,
    WORKER_VALUE_DOC,
    "Share of a manager's mic or charisma that counts when they talk for their worker; 0 means a manager never helps",
  ),
  'match.angle.popularityStatShare': share(
    0.9,
    1,
    WORKER_VALUE_DOC,
    'Share of popularity in the show region that counts when a beat scores popularity; 0 turns popularity off',
  ),
  'match.angle.moralePenaltyMax': share(
    0.15,
    0.5,
    WORKER_VALUE_DOC,
    'Share of every stat lost at the lowest morale (none at morale 0 or above); 0 turns it off',
  ),
  'match.angle.momentumPenaltyMax': share(
    0.1,
    0.5,
    WORKER_VALUE_DOC,
    'Share of every stat lost at the lowest momentum (none at momentum 0 or above); 0 turns it off',
  ),
  'match.angle.momentumBonusMax': share(
    0.05,
    0.5,
    WORKER_VALUE_DOC,
    'Share added to every stat at the highest momentum (none at momentum 0 or below); 0 turns it off',
  ),
  'match.angle.statNoise': noise(
    3,
    10,
    WORKER_VALUE_DOC,
    "Most a person's beat value can move either way on the night; 0 turns the roll off",
  ),
  'match.angle.beatNoise': noise(
    5,
    15,
    BEAT_SCORE_DOC,
    "Most a beat's score can move either way on the night; 0 turns the roll off",
  ),
  'match.angle.maxBeats.short': maxBeats(2, 'short'),
  'match.angle.maxBeats.standard': maxBeats(4, 'standard'),
  'match.angle.maxBeats.long': maxBeats(6, 'long'),
  'match.angle.closingBeatWeight': factor(
    1.25,
    1,
    3,
    'multiplier',
    "How much more the angle's last beat counts than its catalog weight; 1 treats it like any other",
  ),
  'match.angle.repeatFactor': factor(
    0.85,
    0,
    1,
    'multiplier',
    'A beat keeps this share of its score for each earlier beat of the same kind in the angle; 1 turns it off',
  ),
  'match.angle.cardRepeatFactor': factor(
    0.93,
    0,
    1,
    'multiplier',
    'A beat keeps this share of its score for each beat of the same kind earlier on the card; 1 turns it off',
  ),
  'match.angle.crowdBlend': factor(
    0.35,
    0,
    1,
    'ratio',
    "Share of the angle score that comes from the crowd's reaction; 0 rates the beats alone",
  ),
  'match.angle.writingFloorPerLevel': writingPoints(
    3,
    10,
    0.5,
    'Lowest angle score per level of the writing team: strong writing saves a weak talker',
  ),
  'match.angle.writingCeilingAtZero': writingPoints(
    75,
    100,
    1,
    'Highest angle score with no writing team at all',
  ),
  'match.angle.writingCeilingPerLevel': writingPoints(
    2.5,
    10,
    0.5,
    'How much each level of the writing team raises the highest angle score',
  ),
});
