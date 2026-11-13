/**
 * Ring learning's balance numbers (MTCH4-03): how much ring skill one worker picks up in one match.
 *
 * `match.learning.*`: a small base gain per attribute per match, moved by the duration class, by
 * working with someone better, with a teacher, under a skilled producer, by the learning traits and
 * by a mentor on the card; then cut by the hidden learning room (`learningRoom`) and kept within
 * `match.learning.maxPerSegment`.
 *
 * `slowingBand` and `lowPotential` decide the room and are read only by `learningRoom`; they never
 * reach a trace, so a trace never shows the hidden numbers they are compared with.
 *
 * Every key has a minimum of 0, so setting one to 0 means exactly 0.
 *
 * Design: docs/design/physical-toll.md#ring-learning.
 */

import { defineTunables } from '../../../core/tunables/define';
import { DURATION_CLASS_LABELS, type DurationClass } from '../slots';

const PHYSICAL_CATEGORY = 'Physical toll';
const LEARNING_DOC = 'physical-toll.md#ring-learning';

type LearningUnit = 'points' | 'ratio' | 'multiplier';

function learningNumber(
  defaultValue: number,
  range: { max: number; step: number },
  unit: LearningUnit,
  description: string,
) {
  return {
    kind: 'number',
    default: defaultValue,
    min: 0,
    max: range.max,
    step: range.step,
    unit,
    category: PHYSICAL_CATEGORY,
    description,
    docRef: LEARNING_DOC,
  } as const;
}

/** A 0..3 multiplier in steps of 0.05. */
function factor(defaultValue: number, description: string) {
  return learningNumber(defaultValue, { max: 3, step: 0.05 }, 'multiplier', description);
}

function durationFactor(durationClass: DurationClass, defaultValue: number) {
  const word = DURATION_CLASS_LABELS[durationClass].toLowerCase();
  return factor(defaultValue, `How much more a ${word} match teaches than a standard one`);
}

export const learningTunables = defineTunables({
  'match.learning.base': learningNumber(
    0.03,
    { max: 1, step: 0.005 },
    'points',
    'Ring skill one match teaches per attribute before anything moves it',
  ),
  'match.learning.duration.short': durationFactor('short', 0.6),
  'match.learning.duration.standard': durationFactor('standard', 1),
  'match.learning.duration.long': durationFactor('long', 1.4),
  'match.learning.teachGap': learningNumber(
    5,
    { max: 50, step: 1 },
    'points',
    'How much better someone else in the match must be to teach the worker',
  ),
  'match.learning.taughtFactor': factor(2, 'Learning when someone better is in the match'),
  'match.learning.teacherBonus': learningNumber(
    0.5,
    { max: 2, step: 0.05 },
    'ratio',
    'Extra learning for each teacher in the match',
  ),
  'match.learning.maxTeacherFactor': factor(2, 'Most that teachers can multiply learning by'),
  'match.learning.producerMinSkill': learningNumber(
    60,
    { max: 100, step: 1 },
    'points',
    'Producing skill a producer needs to help the workers learn',
  ),
  'match.learning.producerFactor': factor(1.2, 'Learning under a skilled producer'),
  'match.learning.fastLearnerFactor': factor(1.5, 'Learning for a fast learner'),
  'match.learning.slowLearnerFactor': factor(0.6, 'Learning for a slow learner'),
  'match.learning.mentorBonus': learningNumber(
    0.25,
    { max: 2, step: 0.05 },
    'ratio',
    "Extra learning when the worker's mentor is on the same show",
  ),
  'match.learning.roomFactor.slowing': factor(0.4, 'Learning for a worker near their limit'),
  'match.learning.roomFactor.closed': factor(0, 'Learning for a worker at their limit'),
  'match.learning.slowingBand': learningNumber(
    5,
    { max: 50, step: 1 },
    'points',
    'How close to their limit a worker is before learning slows',
  ),
  'match.learning.lowPotential': learningNumber(
    200,
    { max: 1000, step: 10 },
    'points',
    'Below this hidden prospect score, learning slows',
  ),
  'match.learning.maxPerSegment': learningNumber(
    0.2,
    { max: 5, step: 0.01 },
    'points',
    'Most one match can teach per attribute',
  ),
});
