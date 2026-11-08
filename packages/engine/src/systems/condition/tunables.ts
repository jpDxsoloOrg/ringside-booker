/**
 * The condition system's balance numbers: how fast fatigue fades on its own.
 *
 * Both are placeholders for the reference system; see
 * docs/design/calculation-traces.md#worked-example. The real fatigue model replaces or takes over
 * these keys when it lands.
 */

import { defineTunables } from '../../core/tunables/define';

const CONDITION_CATEGORY = 'Condition';
const CONDITION_DOC = 'calculation-traces.md#worked-example';

export const conditionTunables = defineTunables({
  'condition.fatigueRecoveryPerDay': {
    kind: 'number',
    default: 4,
    min: 0,
    max: 100,
    step: 0.5,
    unit: 'points/day',
    category: CONDITION_CATEGORY,
    description: 'Fatigue every person sheds each day before any bonus',
    docRef: CONDITION_DOC,
  },
  'condition.fatigueRecoveryBonusMax': {
    kind: 'integer',
    default: 1,
    min: 0,
    max: 10,
    unit: 'points/day',
    category: CONDITION_CATEGORY,
    description: "Largest random extra recovery per day; 0 turns the roll's effect off",
    docRef: CONDITION_DOC,
  },
});
