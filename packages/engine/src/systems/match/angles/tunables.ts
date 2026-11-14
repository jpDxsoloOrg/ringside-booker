/**
 * The beat formulas' balance numbers (MTCH5-02), category `Angles`. How much a manager's talking
 * counts when they stand in, how much popularity counts as a stat, how far low morale and momentum
 * pull a stat down (and good momentum lifts it), and the two noise rolls. MTCH5-03 appends the
 * angle score's keys here. Design: docs/design/angle-rating.md#beat-worker-value and #beat-score.
 */

import { defineTunables } from '../../../core/tunables/define';

export const ANGLES_TUNABLE_CATEGORY = 'Angles';

const WORKER_VALUE_DOC = 'angle-rating.md#beat-worker-value';
const BEAT_SCORE_DOC = 'angle-rating.md#beat-score';

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
});
