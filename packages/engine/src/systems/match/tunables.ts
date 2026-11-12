/**
 * The match system's balance numbers.
 *
 * `match.slot.*` (D-10): how much each slot role counts toward the show score, the duration class
 * each role implies, and the smallest main card that has a semi-main. The main event has no
 * duration class tunable: it is always long. See docs/design/match-rating.md#slots.
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
});
